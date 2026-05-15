import {
  type CapabilityManifest,
  type CapabilityProviderManifest,
} from '../../../packages/contracts/runtime/capability-manifest.js';
import { loadCoreCapabilityManifestRegistry } from '../capability-manifest-registry.js';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';

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
    healthStatus: CapabilityProviderRoute['status'] | 'unknown';
    permissions: string[];
    requiredConfig: string[];
  }>;
}

export interface CapabilityProviderPreflightResult {
  requiredCapabilityIds: string[];
  routes: CapabilityProviderRoute[];
  ok: boolean;
  blockingRoutes: CapabilityProviderRoute[];
}

type ProviderAvailability = {
  id: string;
  available: boolean;
  status?: CapabilityProviderRoute['status'];
  reason?: string;
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

export function capabilityProviderPreflight(request: GatewayRequest): CapabilityProviderPreflightResult {
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

export function capabilityProviderPreflightPayload(
  request: GatewayRequest,
  preflight: CapabilityProviderPreflightResult,
): ToolPayload | undefined {
  if (preflight.ok || preflight.requiredCapabilityIds.length === 0) return undefined;
  const id = sha1(JSON.stringify({ prompt: request.prompt, routes: preflight.routes })).slice(0, 12);
  const missing = preflight.blockingRoutes.map((route) => `${route.capabilityId}: ${route.reason}`).join('; ');
  const routeRef = `runtime://capability-provider-preflight/${id}`;
  const message = [
    '当前任务需要尚未就绪的工具能力；SciForge 已在发送给 AgentServer 前阻断，避免临时生成不可审计的替代工具。',
    `缺失/不可用能力：${missing}`,
    '请在设置页启用对应 provider，或选择不需要这些能力的场景后重试。',
  ].join('\n');
  return {
    message,
    confidence: 0.86,
    claimType: 'capability-provider-preflight',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'Capability provider preflight resolved required capabilities before AgentServer dispatch.',
      ...preflight.routes.map((route) => `${route.capabilityId} -> ${route.status}: ${route.reason}`),
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-human',
      status: 'needs-human',
    },
    claims: [{
      id: `capability-provider-preflight-${id}`,
      type: 'limitation',
      text: `Missing or unavailable capability providers: ${missing}`,
      confidence: 0.9,
      evidenceLevel: 'runtime',
      supportingRefs: [routeRef],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'runtime-diagnostic',
      artifactRef: `capability-provider-preflight-${id}`,
      title: 'Capability provider preflight',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-capability-provider-preflight-${id}`,
      tool: 'sciforge.capability-provider-preflight',
      status: 'needs-human',
      params: JSON.stringify({
        requiredCapabilityIds: preflight.requiredCapabilityIds,
        routes: preflight.routes,
      }),
      hash: id,
      failureReason: missing,
      recoverActions: [
        'Enable a provider for each missing capability in Settings or Scenario Builder.',
        'Configure AgentServer worker/toolRouting for remote providers.',
        'Retry after provider health/auth/rate-limit is ready.',
      ],
      nextStep: 'Enable the missing provider route, then rerun the task.',
    }],
    artifacts: [{
      id: `capability-provider-preflight-${id}`,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'capability-provider-preflight',
        routeRef,
        requiredCapabilityIds: preflight.requiredCapabilityIds,
        status: 'needs-human',
      },
      data: {
        routes: preflight.routes,
      },
    }],
    objectReferences: [{
      id: `obj-capability-provider-preflight-${id}`,
      kind: 'runtime-diagnostic',
      title: 'Capability provider route preflight',
      ref: routeRef,
      status: 'available',
      summary: missing,
    }],
    failureSignatures: preflight.blockingRoutes.map((route) => ({
      kind: 'external-transient',
      layer: 'external-provider',
      message: route.reason,
      providerId: route.primaryProviderId ?? route.providers[0]?.providerId,
      operation: route.capabilityId,
      retryable: route.status !== 'unauthorized',
      refs: [routeRef],
    })),
  };
}

export function capabilityProviderRoutesForHandoff(request: GatewayRequest): CapabilityProviderPreflightResult {
  return capabilityProviderPreflight(request);
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
    const normalized = normalizeCapabilityId(toolId);
    for (const capabilityId of REQUIRED_BY_TOOL_ID[normalized] ?? []) ids.add(capabilityId);
  }
  if (request.externalIoRequired === true || promptRequiresWebSearch(request.prompt)) ids.add('web_search');
  if (promptRequiresWebFetch(request.prompt)) ids.add('web_fetch');
  if (promptRequiresPdfExtract(request.prompt)) ids.add('pdf_extract');
  return [...ids].sort();
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
        available,
        status,
        reason: 'Configured by scenario tool provider route.',
      },
      ...fallbackProviderIds.map((providerId) => ({
        id: providerId,
        providerId,
        capabilityId: stringField(route.capabilityId),
        source: stringField(route.source),
        available,
        status,
        reason: 'Configured as scenario tool provider fallback.',
      })),
    ];
  });
}

function promptRequiresWebSearch(prompt: string) {
  return /\b(web[-_\s]?search|search web|latest|today|news|arxiv|internet|online|search)\b|最新|今天|今日|检索|搜索|网页|联网|新闻|arxiv/i.test(prompt);
}

function promptRequiresWebFetch(prompt: string) {
  return /\b(web[-_\s]?fetch|fetch|download|read full|full text|url|pdf)\b|下载|全文|链接|网页|读取/i.test(prompt);
}

function promptRequiresPdfExtract(prompt: string) {
  return /\b(pdf|full text)\b|PDF|全文|论文全文/i.test(prompt);
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

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
