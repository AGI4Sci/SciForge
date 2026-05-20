import type { CapabilityProviderManifest } from './capability-manifest';

export type CapabilityProviderRouteStatus = 'ready' | 'missing-provider' | 'provider-unavailable' | 'unauthorized' | 'rate-limited';

export type CapabilityProviderRouteHealthStatus = CapabilityProviderRouteStatus | 'unknown';

export interface CapabilityProviderStatusRoutePolicyInput {
  capabilityId: string;
  primaryProviderId?: string;
  status: string;
  reason: string;
  providers: Array<{
    providerId: string;
    transport?: string;
  }>;
}

export const CAPABILITY_PROVIDER_DISCOVERY_ENDPOINTS = [
  '/api/agent-server/tools/manifest',
  '/api/agent-server/workers',
  '/tools/manifest',
  '/workers',
] as const;

export const GENERATED_TASK_CAPABILITY_FIRST_RULES = [
  'Import sciforge_task from the generated task entrypoint directory for input loading, ToolPayload writing, and provider route inspection.',
  'When capabilityProviderRoutes declares a ready capability route, call invoke_capability(task_input, capabilityId, input). invoke_provider remains a compatibility alias for provider-backed web capabilities.',
  'Do not call requests, urllib, fetch, httpx, aiohttp, or Node http/https for web work that has a ready SciForge provider route.',
  'After invoke_capability, check provider_result_is_empty(result); if empty, write_payload(output_path, empty_result_payload(...)) with refine/recover actions instead of waiting or repairing indefinitely.',
  'If a provider route is unavailable, empty, unauthorized, or rate limited, write an honest repair-needed or failed-with-reason ToolPayload with recoverActions.',
] as const;

export const GENERATED_TASK_CAPABILITY_DISCOVERY_RULES = [
  'Use capability_discovery.search when compact capabilityProviderRoutes/capabilityBrokerBrief are insufficient or a provider/verification/repair route needs alternatives.',
  'Use capability_discovery.expand only for selected capability ids; full schemas/examples/providers are not present in the initial handoff.',
  'Use capability_discovery.plan for composition, fallback, missing provider, missing permission, and expected artifact planning.',
  'Discovery output is audit/planning evidence only; complete the actual task through invoke_capability or an honest failed-with-reason ToolPayload.',
] as const;

export const PLAYWRIGHT_BROWSER_PROVIDER_CLI_RELATIVE_URL = '../../../packages/observe/web/mcp/playwright-browser-provider-cli.ts';
export const PLAYWRIGHT_EDGE_PROVIDER_CLI_RELATIVE_URL = '../../../packages/observe/web/mcp/playwright-edge-provider-cli.ts';

export function capabilityIdsFromProviderPromptPolicy(input: {
  prompt?: string;
  selectedToolIds?: string[];
  externalIoRequired?: boolean;
}) {
  const ids = new Set<string>();
  const prompt = input.prompt ?? '';
  const selected = (input.selectedToolIds ?? []).join(' ');
  const wantsHeadlessBrowserAutomation = headlessBrowserAutomationIntent(prompt, selected);
  const wantsVisibleEdgeAutomation = visibleEdgeBrowserAutomationIntent(prompt, selected);
  if (input.externalIoRequired === true) ids.add('web_search');
  if (scholarlySearchProviderIntent(prompt)) ids.add('web_search');
  if (!wantsHeadlessBrowserAutomation && !wantsVisibleEdgeAutomation && browserProviderIntent(prompt, selected)) {
    ids.add('browser_search');
    ids.add('browser_fetch');
  }
  if (pdfFullTextProviderIntent(prompt, selected)) ids.add('pdf_extract');
  if (wantsHeadlessBrowserAutomation) ids.add('playwright_browser_automation');
  if (wantsVisibleEdgeAutomation) ids.add('playwright_edge_browser');
  return [...ids];
}

export function capabilityIdsForGeneratedTaskProviderRoutes(input: {
  prompt?: string;
  expectedArtifacts?: string[];
  externalIoRequired?: boolean;
}) {
  const ids = new Set<string>();
  const expectedArtifacts = input.expectedArtifacts ?? [];
  const expectsLiteratureRetrievalArtifact = expectedArtifacts.some((artifactType) => (
    artifactType === 'paper-list' || artifactType === 'evidence-matrix'
  ));
  if (input.externalIoRequired || expectsLiteratureRetrievalArtifact) {
    ids.add('web_search');
    ids.add('web_fetch');
  }
  const text = `${input.prompt ?? ''} ${expectedArtifacts.join(' ')}`;
  if (generatedTaskBrowserProviderRoutesRequested(text)) {
    ids.add('browser_search');
    ids.add('browser_fetch');
  }
  if (generatedTaskPdfProviderRouteRequested(text)) ids.add('pdf_extract');
  return [...ids];
}

export function normalizeCapabilityRouteId(value: string) {
  return value.trim().toLowerCase().replace(/[-.\s]+/g, '_');
}

export function normalizeCapabilityProviderRouteStatus(value: string | undefined): CapabilityProviderRouteStatus | undefined {
  if (!value) return undefined;
  if (/unauthori[sz]ed|auth|credential|未授权/.test(value)) return 'unauthorized';
  if (/rate|quota|429|限流|配额/.test(value)) return 'rate-limited';
  if (/missing|offline|unavailable|failed|不可用|离线/.test(value)) return 'provider-unavailable';
  if (/ready|available|online|ok|健康/.test(value)) return 'ready';
  return undefined;
}

export function capabilityProviderDiscoveryUrl(baseUrl: string, endpoint: string) {
  return `${baseUrl.replace(/\/+$/, '')}${endpoint}`;
}

export function capabilityProviderStatusFromManifest(
  provider: Pick<CapabilityProviderManifest, 'status' | 'requiredConfig'>,
  override?: {
    available: boolean;
    status?: CapabilityProviderRouteStatus;
  },
): CapabilityProviderRouteHealthStatus {
  if (override) return override.available ? 'ready' : override.status ?? 'provider-unavailable';
  if (provider.status === 'available') return 'ready';
  if (provider.status === 'unauthorized') return 'unauthorized';
  if (provider.status === 'rate-limited') return 'rate-limited';
  if (provider.requiredConfig.length > 0) return 'provider-unavailable';
  return 'unknown';
}

export function capabilityProviderStatusReason(
  provider: Pick<CapabilityProviderManifest, 'id' | 'requiredConfig'>,
  status: CapabilityProviderRouteHealthStatus,
) {
  if (status === 'ready') return `${provider.id} is ready.`;
  if (status === 'unauthorized') return `${provider.id} is not authorized.`;
  if (status === 'rate-limited') return `${provider.id} is rate limited.`;
  if (provider.requiredConfig.length > 0) return `${provider.id} requires config: ${provider.requiredConfig.join(', ')}`;
  return `${provider.id} has unknown health.`;
}

export function capabilityProviderStatusFastPathMessage(input: {
  routes: CapabilityProviderStatusRoutePolicyInput[];
  selectedIds: string[];
  contextMessage?: string;
}) {
  const routeLines = input.routes.length
    ? input.routes.map((route) => capabilityProviderStatusRouteLine(route))
    : ['- No core web/pdf provider route was required by this status query.'];
  const selectedLine = input.selectedIds.length ? `Selected runtime ids: ${input.selectedIds.join(', ')}` : 'Selected runtime ids: none reported.';
  return [
    'Tool/provider status answered from SciForge runtime registries without dispatching AgentServer generation.',
    selectedLine,
    'Provider routes:',
    ...routeLines,
    input.contextMessage ?? '',
  ].filter((line) => line !== '').join('\n');
}

export function capabilityProviderStatusReasoningTrace() {
  return [
    'Capability/provider status queries are answered from runtime registry and preflight route discovery.',
    'This fast path avoids sending large prior conversation payloads to AgentServer for registry-only follow-up questions.',
  ].join('\n');
}

export function capabilityProviderStatusClaimText(ok: boolean) {
  return ok ? 'Required provider routes are available.' : 'Some requested provider routes are unavailable.';
}

export function capabilityProviderStatusRouteSummaryLines(routes: CapabilityProviderStatusRoutePolicyInput[]) {
  return routes.length
    ? routes.map((route) => capabilityProviderStatusRouteLine(route))
    : ['- No core web/pdf provider route was required by this status query.'];
}

export function capabilityProviderStatusRouteRef(id: string) {
  return `runtime://capability-provider-status/${id}`;
}

export function capabilityProviderRouteTraceRef(capabilityId: string) {
  return `runtime://capability-provider-route/${capabilityId}`;
}

export function capabilityProviderPrimaryRouteProvider<T extends { providerId: string }>(route: {
  primaryProviderId?: string;
  providers: T[];
}) {
  return route.providers.find((candidate) => candidate.providerId === route.primaryProviderId);
}

function capabilityProviderStatusRouteLine(route: CapabilityProviderStatusRoutePolicyInput) {
  const primary = route.primaryProviderId ?? route.providers[0]?.providerId ?? 'none';
  const provider = route.providers.find((candidate) => candidate.providerId === primary);
  const transport = provider?.transport ? `; transport=${provider.transport}` : '';
  return `- ${route.capabilityId}: ${route.status}; primary=${primary}${transport}; ${route.reason}`;
}

export function capabilityProviderRouteStatusFromHealth(status: CapabilityProviderRouteHealthStatus): CapabilityProviderRouteStatus {
  return status === 'unknown' ? 'provider-unavailable' : status;
}

export function capabilityProviderTransportFromAvailability(
  availability?: { endpoint?: unknown; baseUrl?: unknown; invokeUrl?: unknown },
): CapabilityProviderManifest['transport'] {
  return availability?.endpoint || availability?.baseUrl || availability?.invokeUrl ? 'http' : 'backend-native';
}

export function capabilityProviderAvailabilityFromRouteStatus(status: string) {
  return !/unknown|unavailable|unauthori[sz]ed|rate-limited|missing|offline/i.test(status);
}

export function generatedTaskProviderEndpoint(provider: {
  endpoint?: unknown;
  baseUrl?: unknown;
  url?: unknown;
  invokeUrl?: unknown;
} | undefined) {
  if (!provider) return undefined;
  for (const value of [provider.invokeUrl, provider.endpoint, provider.baseUrl, provider.url]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  }
  return undefined;
}

export function generatedTaskProviderUsesMcpCli(route: { capabilityId?: string }, provider?: { transport?: unknown }) {
  return route.capabilityId === 'playwright_browser_automation'
    || route.capabilityId === 'playwright_edge_browser'
    || provider?.transport === 'mcp';
}

export function generatedTaskMcpProviderCliRelativeUrl(route: { capabilityId?: string }) {
  if (route.capabilityId === 'playwright_browser_automation') return PLAYWRIGHT_BROWSER_PROVIDER_CLI_RELATIVE_URL;
  return PLAYWRIGHT_EDGE_PROVIDER_CLI_RELATIVE_URL;
}

export function generatedTaskProviderUsesWebWorkerCli(provider?: { workerId?: unknown; providerId?: unknown }) {
  return provider?.workerId === 'sciforge.web-worker'
    || (typeof provider?.providerId === 'string' && /^sciforge\.web-worker\./.test(provider.providerId));
}

function scholarlySearchProviderIntent(prompt: string): boolean {
  return /\b(?:arxiv|pubmed|biorxiv|medrxiv|doi|pmid)\b|论文|文献|预印本/i.test(prompt);
}

function browserProviderIntent(prompt: string, selected: string): boolean {
  return /(?:browser|chromium|rendered|javascript|\bjs\b|dynamic page|single[-\s]?page(?:\s+app(?:lication)?)?|\bspa\b|网页|浏览器|渲染|动态页面|打开网页|下载|pdf|full[-\s]?text|全文|阅读全文)/i.test(`${prompt} ${selected}`);
}

function pdfFullTextProviderIntent(prompt: string, selected: string): boolean {
  return /(?:pdf|full[-\s]?text|全文|阅读全文|全文阅读|extract(?:ed|ion)?|下载.*论文|论文.*下载)/i.test(`${prompt} ${selected}`);
}

function headlessBrowserAutomationIntent(prompt: string, selected: string): boolean {
  return /(?:playwright_browser_automation|playwright[_\s-]*browser|headless|isolated browser|background browser|unattended browser|browser automation|通用浏览器|后台浏览器|无感|不影响用户|浏览器自动化)/i.test(`${prompt} ${selected}`);
}

function visibleEdgeBrowserAutomationIntent(prompt: string, selected: string): boolean {
  return /(?:playwright_edge_browser|sciforge\.observe\.playwright-edge-mcp|playwright[_\s-]*edge|microsoft\s*edge|msedge|headed|visible browser|manual takeover|login|captcha|2fa|otp|可见浏览器|手动接管|登录|验证码|二次验证|双因素)/i.test(`${prompt} ${selected}`);
}

function generatedTaskBrowserProviderRoutesRequested(text: string): boolean {
  return /(?:browser|chromium|rendered|javascript|\bjs\b|dynamic page|single-page|spa|网页|浏览器|渲染|动态页面|打开网页|下载|pdf|full[-\s]?text|全文|阅读全文)/i.test(text);
}

function generatedTaskPdfProviderRouteRequested(text: string): boolean {
  return /(?:pdf|full[-\s]?text|全文|阅读全文|全文阅读|extract(?:ed|ion)?|下载.*论文|论文.*下载)/i.test(text);
}
