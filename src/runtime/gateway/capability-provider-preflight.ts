import {
  type CapabilityManifest,
  type CapabilityProviderManifest,
} from '../../../packages/contracts/runtime/capability-manifest.js';
import { loadCoreCapabilityManifestRegistry } from '../capability-manifest-registry.js';
import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';

export interface CapabilityProviderRoute {
  capabilityId: string;
  primaryProviderId?: string;
  fallbackProviderIds: string[];
  status: 'ready' | 'missing-provider' | 'provider-unavailable' | 'unauthorized' | 'rate-limited';
  reason: string;
  providers: Array<{
    providerId: string;
    source?: CapabilityProviderManifest['source'];
    transport?: CapabilityProviderManifest['transport'];
    workerId?: string;
    runtimeLocation?: string;
    endpoint?: string;
    baseUrl?: string;
    url?: string;
    invokeUrl?: string;
    invokePath?: string;
    timeoutMs?: number;
    healthStatus: CapabilityProviderRoute['status'] | 'unknown';
    permissions: string[];
    requiredConfig: string[];
  }>;
}

export interface PublicCapabilityProviderRoute {
  capabilityId: string;
  primaryProviderId?: string;
  fallbackProviderIds: string[];
  status: CapabilityProviderRoute['status'];
  reason: string;
  routeTraceRef: string;
  providers: Array<{
    providerId: string;
    source?: CapabilityProviderManifest['source'];
    transport?: CapabilityProviderManifest['transport'];
    healthStatus: CapabilityProviderRoute['status'] | 'unknown';
  }>;
}

export interface CapabilityProviderPreflightResult {
  requiredCapabilityIds: string[];
  routes: CapabilityProviderRoute[];
  ok: boolean;
  blockingRoutes: CapabilityProviderRoute[];
}

export interface PublicCapabilityProviderPreflightResult {
  requiredCapabilityIds: string[];
  routes: PublicCapabilityProviderRoute[];
  ok: boolean;
  blockingRoutes: PublicCapabilityProviderRoute[];
}

type ProviderAvailability = {
  id: string;
  available: boolean;
  status?: CapabilityProviderRoute['status'];
  reason?: string;
  endpoint?: string;
  baseUrl?: string;
  url?: string;
  invokeUrl?: string;
  invokePath?: string;
  timeoutMs?: number;
};

const REQUIRED_BY_TOOL_ID: Record<string, string[]> = {
  'web-search': ['web_search'],
  web_search: ['web_search'],
  webfetch: ['web_fetch'],
  'web-fetch': ['web_fetch'],
  web_fetch: ['web_fetch'],
  'pdf-extract': ['pdf_extract'],
  pdf_extract: ['pdf_extract'],
};

export const CAPABILITY_PROVIDER_ROUTE_REF_PREFIX = 'runtime://capability-provider-route/';

export function resolveCapabilityProviderRoutes(request: GatewayRequest): CapabilityProviderPreflightResult {
  const requiredCapabilityIds = inferRequiredCapabilityIds(request);
  const routes = requiredCapabilityIds.map((capabilityId) => resolveCapabilityRoute(request, capabilityId));
  const blockingRoutes = routes.filter((route) => route.status !== 'ready');
  return {
    requiredCapabilityIds,
    routes,
    blockingRoutes,
    ok: blockingRoutes.length === 0,
  };
}

export function capabilityProviderPreflight(request: GatewayRequest): CapabilityProviderPreflightResult { return resolveCapabilityProviderRoutes(request); }

export function capabilityProviderRoutesForHandoff(request: GatewayRequest): PublicCapabilityProviderPreflightResult {
  return publicCapabilityProviderPreflightResult(resolveCapabilityProviderRoutes(request));
}

export function capabilityProviderRoutesForGatewayInvocation(request: GatewayRequest): CapabilityProviderPreflightResult { return resolveCapabilityProviderRoutes(request); }

export function publicCapabilityProviderPreflightResult(
  preflight: CapabilityProviderPreflightResult,
): PublicCapabilityProviderPreflightResult {
  const routes = preflight.routes.map(publicCapabilityProviderRoute);
  const blockingRouteIds = new Set(preflight.blockingRoutes.map((route) => route.capabilityId));
  return {
    requiredCapabilityIds: [...preflight.requiredCapabilityIds],
    routes,
    ok: preflight.ok,
    blockingRoutes: routes.filter((route) => blockingRouteIds.has(route.capabilityId)),
  };
}

function publicCapabilityProviderRoute(route: CapabilityProviderRoute): PublicCapabilityProviderRoute {
  return {
    capabilityId: route.capabilityId,
    primaryProviderId: route.primaryProviderId,
    fallbackProviderIds: [...route.fallbackProviderIds],
    status: route.status,
    reason: route.reason,
    routeTraceRef: capabilityRouteTraceRef(route.capabilityId),
    providers: route.providers.map((provider) => publicCapabilityProvider(provider)),
  };
}

function capabilityRouteTraceRef(capabilityId: string) {
  return `${CAPABILITY_PROVIDER_ROUTE_REF_PREFIX}${capabilityId}`;
}

function publicCapabilityProvider(provider: CapabilityProviderRoute['providers'][number]) {
  return {
    providerId: provider.providerId,
    source: provider.source,
    transport: provider.transport,
    healthStatus: provider.healthStatus,
  };
}

export async function requestWithDiscoveredCapabilityProviders(request: GatewayRequest): Promise<GatewayRequest> {
  const baseUrl = stringField(request.agentServerBaseUrl);
  if (!baseUrl) return request;
  const discovered = await discoverAgentServerProviderAvailability(baseUrl);
  if (!discovered.length) return request;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return {
    ...request,
    uiState: {
      ...uiState,
      capabilityProviderAvailability: [
        ...toRecordList(uiState.capabilityProviderAvailability),
        ...discovered,
      ],
    },
  };
}

async function discoverAgentServerProviderAvailability(baseUrl: string): Promise<Array<Record<string, unknown>>> {
  const endpoints = [
    '/api/agent-server/tools/manifest',
    '/api/agent-server/workers',
    '/tools/manifest',
    '/workers',
  ];
  const rows: Array<Record<string, unknown>> = [];
  await Promise.all(endpoints.map(async (endpoint) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 750);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${endpoint}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return;
      const payload = unwrapDiscoveryPayload(await response.json());
      rows.push(...providerAvailabilityRowsFromDiscoveryPayload(payload));
    } catch {
      // Discovery is opportunistic. Preflight still reports missing providers.
    }
  }));
  return dedupeProviderRows(rows);
}

function unwrapDiscoveryPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if (payload.ok === true && 'data' in payload) return payload.data;
  return payload;
}

function providerAvailabilityRowsFromDiscoveryPayload(payload: unknown): Array<Record<string, unknown>> {
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.providers)
      ? payload.providers
      : isRecord(payload) && Array.isArray(payload.workers)
        ? payload.workers
        : isRecord(payload) && Array.isArray(payload.tools)
          ? payload.tools
          : [];
  return records.filter(isRecord).flatMap((record) => {
    const id = stringField(record.id) ?? stringField(record.providerId) ?? stringField(record.workerId);
    const available = record.available === true || record.status === 'available' || record.status === 'online' || record.health === 'online';
    const rows: Array<Record<string, unknown>> = [];
    if (id) rows.push({ ...record, id, available });
    return rows;
  });
}

function dedupeProviderRows(rows: Array<Record<string, unknown>>) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = stringField(row.id) ?? stringField(row.providerId) ?? stringField(row.workerId);
    if (id) byId.set(id, row);
  }
  return [...byId.values()];
}

function inferRequiredCapabilityIds(request: GatewayRequest): string[] {
  const ids = new Set<string>();
  for (const toolId of [...(request.selectedToolIds ?? []), ...toStringList(request.uiState?.selectedToolIds)]) {
    for (const capabilityId of requiredCapabilityIdsForSelectedTool(toolId)) ids.add(capabilityId);
  }
  for (const capabilityId of structuredRequiredCapabilityIds(request)) ids.add(capabilityId);
  if (request.externalIoRequired === true) ids.add('web_search');
  return [...ids].sort();
}

function requiredCapabilityIdsForSelectedTool(toolId: string) {
  const normalized = normalizeCapabilityId(toolId);
  const mapped = REQUIRED_BY_TOOL_ID[normalized];
  if (mapped) return mapped;
  return defaultCapabilityManifestFor(normalized) ? [normalized] : [];
}

function structuredRequiredCapabilityIds(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([
    ...capabilityIdsFromProviderRoutes(uiState.toolProviderRoutes),
    ...capabilityIdsFromProviderRoutes(uiState.capabilityProviderRoutes),
    ...capabilityIdsFromStructuredPolicy(uiState.agentHarness),
    ...capabilityIdsFromStructuredPolicy(uiState.conversationPolicy),
  ]).filter((capabilityId) => Boolean(defaultCapabilityManifestFor(capabilityId)));
}

function resolveCapabilityRoute(request: GatewayRequest, capabilityId: string): CapabilityProviderRoute {
  const manifest = defaultCapabilityManifestFor(capabilityId);
  const providers = providerCandidates(request, manifest, capabilityId);
  if (!providers.length) {
    return {
      capabilityId,
      fallbackProviderIds: [],
      status: 'missing-provider',
      reason: 'No provider is registered for this capability.',
      providers: [],
    };
  }
  const primary = providers[0]!;
  const ready = providers.find((provider) => provider.status === 'ready');
  const routeProviders = providers.map((provider) => ({
    providerId: provider.provider.id,
    source: provider.provider.source,
    transport: provider.provider.transport,
    workerId: provider.provider.workerId,
    runtimeLocation: provider.provider.runtimeLocation,
    endpoint: provider.endpoint,
    baseUrl: provider.baseUrl,
    url: provider.url,
    invokeUrl: provider.invokeUrl,
    invokePath: provider.invokePath,
    timeoutMs: provider.timeoutMs,
    healthStatus: provider.status,
    permissions: provider.provider.permissions ?? [],
    requiredConfig: provider.provider.requiredConfig,
  }));
  if (ready) {
    return {
      capabilityId,
      primaryProviderId: ready.provider.id,
      fallbackProviderIds: providers.filter((provider) => provider.provider.id !== ready.provider.id).map((provider) => provider.provider.id),
      status: 'ready',
      reason: `${ready.provider.id} is ready.`,
      providers: routeProviders,
    };
  }
  return {
    capabilityId,
    primaryProviderId: primary.provider.id,
    fallbackProviderIds: providers.slice(1).map((provider) => provider.provider.id),
    status: primary.status === 'unknown' ? 'provider-unavailable' : primary.status,
    reason: primary.reason,
    providers: routeProviders,
  };
}

function defaultCapabilityManifestFor(capabilityId: string) {
  return loadCoreCapabilityManifestRegistry().getManifest(capabilityId);
}

function providerCandidates(request: GatewayRequest, manifest: CapabilityManifest | undefined, capabilityId: string) {
  const availability = providerAvailabilityById(request);
  return (manifest?.providers ?? []).map((provider) => {
    const override = availability.get(provider.id) ?? availability.get(provider.workerId ?? '');
    const status = providerStatus(provider, override);
    return {
      provider,
      endpoint: override?.endpoint,
      baseUrl: override?.baseUrl,
      url: override?.url,
      invokeUrl: override?.invokeUrl,
      invokePath: override?.invokePath,
      timeoutMs: override?.timeoutMs,
      status,
      reason: override?.reason ?? providerStatusReason(provider, status),
    };
  });
}

function providerStatus(provider: CapabilityProviderManifest, override: ProviderAvailability | undefined): CapabilityProviderRoute['status'] | 'unknown' {
  if (override) return override.available ? 'ready' : override.status ?? 'provider-unavailable';
  if (provider.status === 'available') return 'ready';
  if (provider.status === 'unauthorized') return 'unauthorized';
  if (provider.status === 'rate-limited') return 'rate-limited';
  if (provider.requiredConfig.length > 0) return 'provider-unavailable';
  return 'unknown';
}

function providerStatusReason(provider: CapabilityProviderManifest, status: CapabilityProviderRoute['status'] | 'unknown') {
  if (status === 'ready') return `${provider.id} is ready.`;
  if (status === 'unauthorized') return `${provider.id} is not authorized.`;
  if (status === 'rate-limited') return `${provider.id} is rate limited.`;
  if (provider.requiredConfig.length > 0) return `${provider.id} requires config: ${provider.requiredConfig.join(', ')}`;
  return `${provider.id} has unknown health.`;
}

function providerAvailabilityById(request: GatewayRequest) {
  const rows = [
    ...providerAvailabilityRowsFromToolProviderRoutes(request.uiState?.toolProviderRoutes),
    ...toRecordList(request.uiState?.agentServerWorkers),
    ...toRecordList(request.uiState?.capabilityProviderAvailability),
    ...toRecordList(request.uiState?.agentServerProviderAvailability),
  ];
  const map = new Map<string, ProviderAvailability>();
  for (const row of rows) {
    const id = stringField(row.id) ?? stringField(row.providerId) ?? stringField(row.workerId);
    if (!id) continue;
    const available = row.available === true || row.status === 'available' || row.status === 'online' || row.health === 'online';
    map.set(id, {
      id,
      available,
      status: normalizeRouteStatus(stringField(row.status) ?? stringField(row.health)),
      reason: stringField(row.reason) ?? stringField(row.detail),
      endpoint: stringField(row.endpoint),
      baseUrl: stringField(row.baseUrl),
      url: stringField(row.url),
      invokeUrl: stringField(row.invokeUrl),
      invokePath: stringField(row.invokePath),
      timeoutMs: numberField(row.timeoutMs),
    });
  }
  return map;
}

function providerAvailabilityRowsFromToolProviderRoutes(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([routeKey, route]) => {
    if (!isRecord(route) || route.enabled === false) return [];
    const primaryProviderId = stringField(route.primaryProviderId) ?? stringField(route.providerId) ?? routeKey;
    const fallbackProviderIds = toStringList(route.fallbackProviderIds);
    const status = stringField(route.health) ?? stringField(route.status) ?? 'available';
    const available = !/unknown|unavailable|unauthori[sz]ed|rate-limited|missing|offline/i.test(status);
    return [
      {
        id: primaryProviderId,
        providerId: primaryProviderId,
        capabilityId: stringField(route.capabilityId),
        source: stringField(route.source),
        endpoint: stringField(route.endpoint),
        baseUrl: stringField(route.baseUrl),
        url: stringField(route.url),
        invokeUrl: stringField(route.invokeUrl),
        invokePath: stringField(route.invokePath),
        timeoutMs: numberField(route.timeoutMs),
        available,
        status,
        reason: 'Configured by scenario tool provider route.',
      },
      ...fallbackProviderIds.map((providerId) => ({
        id: providerId,
        providerId,
        capabilityId: stringField(route.capabilityId),
        source: stringField(route.source),
        endpoint: stringField(route.endpoint),
        baseUrl: stringField(route.baseUrl),
        url: stringField(route.url),
        invokeUrl: stringField(route.invokeUrl),
        invokePath: stringField(route.invokePath),
        timeoutMs: numberField(route.timeoutMs),
        available,
        status,
        reason: 'Configured as scenario tool provider fallback.',
      })),
    ];
  });
}

function capabilityIdsFromProviderRoutes(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([routeKey, route]) => {
    if (!isRecord(route) || route.enabled === false) return [];
    const capabilityId = normalizeCapabilityId(stringField(route.capabilityId) ?? routeKey);
    return capabilityId ? [capabilityId] : [];
  });
}

function capabilityIdsFromStructuredPolicy(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const contract = isRecord(value.contract) ? value.contract : value;
  const policy = isRecord(contract.capabilityPolicy) ? contract.capabilityPolicy : {};
  return [
    ...capabilityIdsFromStructuredPolicyRecord(contract),
    ...capabilityIdsFromStructuredPolicyRecord(policy),
  ];
}

function capabilityIdsFromStructuredPolicyRecord(value: Record<string, unknown>): string[] {
  return [
    ...toStringList(value.requiredCapabilityIds),
    ...toStringList(value.selectedCapabilityIds),
  ].map(normalizeCapabilityId);
}

function normalizeCapabilityId(value: string) {
  return value.trim().toLowerCase().replace(/[-.\s]+/g, '_');
}

function normalizeRouteStatus(value: string | undefined): CapabilityProviderRoute['status'] | undefined {
  if (!value) return undefined;
  if (/unauthori[sz]ed|auth|credential|未授权/.test(value)) return 'unauthorized';
  if (/rate|quota|429|限流|配额/.test(value)) return 'rate-limited';
  if (/missing|offline|unavailable|failed|不可用|离线/.test(value)) return 'provider-unavailable';
  if (/ready|available|online|ok|健康/.test(value)) return 'ready';
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
