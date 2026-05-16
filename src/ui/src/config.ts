import type { PeerInstance, PeerInstanceRole, PeerInstanceTrustLevel, SciForgeConfig } from './domain';

const buildDefaults = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};
const SCIFORGE_INSTANCE_ID = cleanStorageKeySegment(buildDefaults.VITE_SCIFORGE_INSTANCE_ID);
const CONFIG_STORAGE_KEY = scopedSciForgeStorageKey('sciforge.config.v1');
const LEGACY_DEFAULT_AGENT_SERVER_URL = 'http://127.0.0.1:18080';
const LEGACY_DEFAULT_WORKSPACE_WRITER_URL = 'http://127.0.0.1:5174';
const LEGACY_DEFAULT_WORKSPACE_PATH = '/Applications/workspace/ailab/research/app/SciForge/workspace';

export const defaultSciForgeConfig: SciForgeConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: buildDefaults.VITE_SCIFORGE_DEFAULT_AGENT_SERVER_URL || 'http://127.0.0.1:18080',
  workspaceWriterBaseUrl: buildDefaults.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL || 'http://127.0.0.1:5174',
  workspacePath: buildDefaults.VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH || '/Applications/workspace/ailab/research/app/SciForge/workspace',
  peerInstances: [],
  /** Default feedback inbox target; override in settings if you fork or use another repo. */
  feedbackGithubRepo: 'AGI4Sci/SciForge',
  theme: 'dark',
  agentBackend: 'codex',
  modelProvider: 'native',
  modelBaseUrl: '',
  modelName: '',
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
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(feedbackGithubRepo ? { feedbackGithubRepo } : {}),
    ...(feedbackGithubToken ? { feedbackGithubToken } : {}),
  };
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
