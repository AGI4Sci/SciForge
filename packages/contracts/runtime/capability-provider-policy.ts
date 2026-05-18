import type { CapabilityProviderManifest } from './capability-manifest';

export type CapabilityProviderRouteStatus = 'ready' | 'missing-provider' | 'provider-unavailable' | 'unauthorized' | 'rate-limited';

export type CapabilityProviderRouteHealthStatus = CapabilityProviderRouteStatus | 'unknown';

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

export const PLAYWRIGHT_EDGE_PROVIDER_CLI_RELATIVE_URL = '../../../packages/observe/web/mcp/playwright-edge-provider-cli.ts';

export function capabilityIdsFromProviderPromptPolicy(input: {
  prompt?: string;
  selectedToolIds?: string[];
  externalIoRequired?: boolean;
}) {
  const ids = new Set<string>();
  const prompt = input.prompt ?? '';
  const selected = (input.selectedToolIds ?? []).join(' ');
  if (input.externalIoRequired === true) ids.add('web_search');
  if (scholarlySearchProviderIntent(prompt)) ids.add('web_search');
  if (browserProviderIntent(prompt, selected)) {
    ids.add('browser_search');
    ids.add('browser_fetch');
  }
  if (pdfFullTextProviderIntent(prompt, selected)) ids.add('pdf_extract');
  if (interactiveBrowserAutomationIntent(prompt, selected)) ids.add('playwright_edge_browser');
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
  return route.capabilityId === 'playwright_edge_browser' || provider?.transport === 'mcp';
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

function interactiveBrowserAutomationIntent(prompt: string, selected: string): boolean {
  return /(?:playwright[_\s-]*edge|playwright[_\s-]*mcp|microsoft\s*edge|msedge|headed|visible browser|manual takeover|login|captcha|2fa|otp|form|fill|click|scroll|upload|download|browser automation|正常网页浏览器|可见浏览器|手动接管|登录|验证码|二次验证|双因素|表单|填写|点击|滚动|上传|下载|浏览器自动化)/i.test(`${prompt} ${selected}`);
}

function generatedTaskBrowserProviderRoutesRequested(text: string): boolean {
  return /(?:browser|chromium|rendered|javascript|\bjs\b|dynamic page|single-page|spa|网页|浏览器|渲染|动态页面|打开网页|下载|pdf|full[-\s]?text|全文|阅读全文)/i.test(text);
}

function generatedTaskPdfProviderRouteRequested(text: string): boolean {
  return /(?:pdf|full[-\s]?text|全文|阅读全文|全文阅读|extract(?:ed|ion)?|下载.*论文|论文.*下载)/i.test(text);
}
