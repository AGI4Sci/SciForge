import type { PeerInstance, PeerInstanceRole, PeerInstanceTrustLevel, SciForgeConfig, ToolProviderRouteOverride, ToolProviderSource } from './domain';

const buildDefaults = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};
const SCIFORGE_INSTANCE_ID = cleanStorageKeySegment(buildDefaults.VITE_SCIFORGE_INSTANCE_ID);
const CONFIG_STORAGE_KEY = scopedSciForgeStorageKey('sciforge.config.v1');
const LEGACY_DEFAULT_AGENT_SERVER_URL = 'http://127.0.0.1:18080';
const LEGACY_DEFAULT_WORKSPACE_WRITER_URL = 'http://127.0.0.1:5174';
const LEGACY_DEFAULT_WORKSPACE_PATH = '/Applications/workspace/ailab/research/app/SciForge/workspace';
const DEFAULT_WORKSPACE_PATH = '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1';
export const DEFAULT_CODEX_RUNTIME_PROFILE = 'sciforge-runtime-deepseek';
export const DEFAULT_CODEX_RUNTIME_PROVIDER = 'sciforge-deepseek-proxy';
export const DEFAULT_CODEX_RUNTIME_MODEL = 'bailian/deepseek-v4-flash';
export const DEFAULT_CODEX_RUNTIME_BASE_URL = 'http://127.0.0.1:4765/v1';

export const defaultSciForgeConfig: SciForgeConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: buildDefaults.VITE_SCIFORGE_DEFAULT_AGENT_SERVER_URL || 'http://127.0.0.1:18080',
  workspaceWriterBaseUrl: buildDefaults.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL || 'http://127.0.0.1:5174',
  workspacePath: buildDefaults.VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH || DEFAULT_WORKSPACE_PATH,
  peerInstances: [],
  /** Default feedback inbox target; override in settings if you fork or use another repo. */
  feedbackGithubRepo: 'AGI4Sci/SciForge',
  theme: 'dark',
  agentBackend: 'codex',
  runtimeProfile: DEFAULT_CODEX_RUNTIME_PROFILE,
  allowOpenAiRuntime: false,
  modelProvider: DEFAULT_CODEX_RUNTIME_PROVIDER,
  modelBaseUrl: DEFAULT_CODEX_RUNTIME_BASE_URL,
  modelName: DEFAULT_CODEX_RUNTIME_MODEL,
  apiKey: '',
  requestTimeoutMs: 900_000,
  maxContextWindowTokens: 200_000,
  visionAllowSharedSystemInput: true,
  updatedAt: new Date().toISOString(),
};

export function loadSciForgeConfig(): SciForgeConfig {
  if (typeof window === 'undefined') return defaultSciForgeConfig;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) return applyBuildRuntimeDefaults(normalizeConfig(JSON.parse(raw)));
    return defaultSciForgeConfig;
  } catch {
    return defaultSciForgeConfig;
  }
}

function applyBuildRuntimeDefaults(config: SciForgeConfig): SciForgeConfig {
  return {
    ...config,
    agentServerBaseUrl: config.agentServerBaseUrl === LEGACY_DEFAULT_AGENT_SERVER_URL
      ? defaultSciForgeConfig.agentServerBaseUrl
      : config.agentServerBaseUrl,
    workspaceWriterBaseUrl: config.workspaceWriterBaseUrl === LEGACY_DEFAULT_WORKSPACE_WRITER_URL
      ? defaultSciForgeConfig.workspaceWriterBaseUrl
      : config.workspaceWriterBaseUrl,
    workspacePath: config.workspacePath === LEGACY_DEFAULT_WORKSPACE_PATH
      ? defaultSciForgeConfig.workspacePath
      : config.workspacePath,
  };
}

export function saveSciForgeConfig(config: SciForgeConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function cleanStorageKeySegment(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') : '';
}

export function scopedSciForgeStorageKey(baseKey: string) {
  return SCIFORGE_INSTANCE_ID ? `${baseKey}.${SCIFORGE_INSTANCE_ID}` : baseKey;
}

export function normalizeFeedbackGithubRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let s = value.trim().replace(/\.git$/i, '');
  if (!s) return undefined;
  const fromUrl = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(s);
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2]}`;
  const slash = /^([\w.-]+)\/([\w.-]+)$/.exec(s.replace(/^\/+/, ''));
  return slash ? `${slash[1]}/${slash[2]}` : undefined;
}

export function normalizeFeedbackGithubToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

export function normalizeConfig(value: unknown): SciForgeConfig {
  const raw = typeof value === 'object' && value !== null ? value as Partial<SciForgeConfig> : {};
  const { feedbackGithubRepo: rawFeedbackRepo, feedbackGithubToken: rawFeedbackToken, ...rawRest } = raw;
  const feedbackGithubRepo = normalizeFeedbackGithubRepo(rawFeedbackRepo);
  const feedbackGithubToken = normalizeFeedbackGithubToken(rawFeedbackToken);
  return {
    ...defaultSciForgeConfig,
    ...rawRest,
    schemaVersion: 1,
    agentServerBaseUrl: cleanUrl(raw.agentServerBaseUrl) || defaultSciForgeConfig.agentServerBaseUrl,
    workspaceWriterBaseUrl: cleanUrl(raw.workspaceWriterBaseUrl) || defaultSciForgeConfig.workspaceWriterBaseUrl,
    workspacePath: normalizeWorkspaceRootPath(typeof raw.workspacePath === 'string' ? raw.workspacePath : defaultSciForgeConfig.workspacePath),
    peerInstances: normalizePeerInstances(raw.peerInstances),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    agentBackend: normalizeAgentBackend(raw.agentBackend),
    runtimeProfile: normalizeRuntimeProfile(raw.runtimeProfile),
    allowOpenAiRuntime: raw.allowOpenAiRuntime === true,
    modelProvider: typeof raw.modelProvider === 'string' ? raw.modelProvider : defaultSciForgeConfig.modelProvider,
    modelBaseUrl: cleanUrl(raw.modelBaseUrl) || '',
    modelName: typeof raw.modelName === 'string' ? raw.modelName : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    requestTimeoutMs: typeof raw.requestTimeoutMs === 'number' && Number.isFinite(raw.requestTimeoutMs)
      ? Math.max(30_000, Math.trunc(raw.requestTimeoutMs))
      : defaultSciForgeConfig.requestTimeoutMs,
    maxContextWindowTokens: typeof raw.maxContextWindowTokens === 'number' && Number.isFinite(raw.maxContextWindowTokens)
      ? Math.max(1_000, Math.trunc(raw.maxContextWindowTokens))
      : defaultSciForgeConfig.maxContextWindowTokens,
    visionAllowSharedSystemInput: typeof raw.visionAllowSharedSystemInput === 'boolean'
      ? raw.visionAllowSharedSystemInput
      : defaultSciForgeConfig.visionAllowSharedSystemInput,
    toolProviderRoutes: normalizeToolProviderRoutes(raw.toolProviderRoutes),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(feedbackGithubRepo ? { feedbackGithubRepo } : {}),
    ...(feedbackGithubToken ? { feedbackGithubToken } : {}),
  };
}

export function normalizeToolProviderRoutes(value: unknown): Record<string, ToolProviderRouteOverride> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, ToolProviderRouteOverride> = {};
  for (const [rawKey, rawRoute] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key || !isRecord(rawRoute)) continue;
    const route: ToolProviderRouteOverride = {};
    if (typeof rawRoute.enabled === 'boolean') route.enabled = rawRoute.enabled;
    if (typeof rawRoute.capabilityId === 'string' && rawRoute.capabilityId.trim()) route.capabilityId = rawRoute.capabilityId.trim();
    const source = normalizeToolProviderSource(rawRoute.source);
    if (source) route.source = source;
    if (typeof rawRoute.primaryProviderId === 'string' && rawRoute.primaryProviderId.trim()) route.primaryProviderId = rawRoute.primaryProviderId.trim();
    if (Array.isArray(rawRoute.fallbackProviderIds)) {
      const fallbackProviderIds = rawRoute.fallbackProviderIds
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim());
      if (fallbackProviderIds.length) route.fallbackProviderIds = Array.from(new Set(fallbackProviderIds));
    }
    const permissions = stringArray(rawRoute.permissions);
    if (permissions?.length) route.permissions = permissions;
    const requiredConfig = stringArray(rawRoute.requiredConfig);
    if (requiredConfig?.length) route.requiredConfig = requiredConfig;
    const health = normalizeToolProviderRouteHealth(rawRoute.health);
    if (health) route.health = health;
    for (const keyName of ['endpoint', 'baseUrl', 'url', 'invokeUrl', 'invokePath'] as const) {
      const routeValue = rawRoute[keyName];
      if (typeof routeValue === 'string' && routeValue.trim()) route[keyName] = routeValue.trim().replace(/\/+$/, '');
    }
    if (typeof rawRoute.timeoutMs === 'number' && Number.isFinite(rawRoute.timeoutMs)) {
      route.timeoutMs = Math.max(1_000, Math.trunc(rawRoute.timeoutMs));
    }
    if (Object.keys(route).length) out[key] = route;
  }
  return Object.keys(out).length ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())));
}

function normalizeToolProviderSource(value: unknown): ToolProviderSource | undefined {
  return value === 'local'
    || value === 'agentserver'
    || value === 'mcp'
    || value === 'http'
    || value === 'ssh'
    || value === 'client-worker'
    || value === 'backend-native'
    || value === 'package'
    || value === 'workspace'
    || value === 'external'
    ? value
    : undefined;
}

function normalizeToolProviderRouteHealth(value: unknown): ToolProviderRouteOverride['health'] | undefined {
  return value === 'ready'
    || value === 'unknown'
    || value === 'unavailable'
    || value === 'unauthorized'
    || value === 'rate-limited'
    ? value
    : undefined;
}

export function normalizePeerInstances(value: unknown): PeerInstance[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      appUrl: cleanUrl(item.appUrl),
      workspaceWriterUrl: cleanUrl(item.workspaceWriterUrl),
      workspacePath: normalizeWorkspaceRootPath(typeof item.workspacePath === 'string' ? item.workspacePath : ''),
      role: normalizePeerRole(item.role),
      trustLevel: normalizePeerTrustLevel(item.trustLevel),
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    }));
}

export function validatePeerInstances(peerInstances: PeerInstance[]): string[] {
  const errors: string[] = [];
  const seenNames = new Map<string, number>();
  peerInstances.forEach((peer, index) => {
    const label = peer.name.trim() || `Peer ${index + 1}`;
    const normalizedName = peer.name.trim().toLowerCase();
    if (!peer.name.trim()) errors.push(`${label}: name is required.`);
    if (normalizedName) {
      const count = seenNames.get(normalizedName) ?? 0;
      seenNames.set(normalizedName, count + 1);
      if (count > 0) errors.push(`${label}: name must be unique.`);
    }
    if (peer.appUrl.trim() && !isValidHttpUrl(peer.appUrl)) errors.push(`${label}: appUrl must be a valid http(s) URL.`);
    if (!peer.workspaceWriterUrl.trim()) {
      errors.push(`${label}: workspaceWriterUrl is required.`);
    } else if (!isValidHttpUrl(peer.workspaceWriterUrl)) {
      errors.push(`${label}: workspaceWriterUrl must be a valid http(s) URL.`);
    }
  });
  return errors;
}

export function updateConfig(config: SciForgeConfig, patch: Partial<SciForgeConfig>): SciForgeConfig {
  return normalizeConfig({
    ...config,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function cleanUrl(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function normalizeAgentBackend(value: unknown) {
  const backend = typeof value === 'string' ? value.trim() : '';
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'].includes(backend)
    ? backend
    : defaultSciForgeConfig.agentBackend;
}

function normalizeRuntimeProfile(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : defaultSciForgeConfig.runtimeProfile;
}

function normalizePeerRole(value: unknown): PeerInstanceRole {
  return value === 'main' || value === 'repair' || value === 'peer' ? value : 'peer';
}

function normalizePeerTrustLevel(value: unknown): PeerInstanceTrustLevel {
  return value === 'readonly' || value === 'repair' || value === 'sync' ? value : 'readonly';
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeWorkspaceRootPath(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const marker = '/.sciforge/';
  const nestedIndex = trimmed.indexOf(marker);
  if (nestedIndex >= 0) return trimmed.slice(0, nestedIndex);
  if (trimmed.endsWith('/.sciforge')) return trimmed.slice(0, -'/.sciforge'.length);
  return trimmed;
}
