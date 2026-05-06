import type { SciForgeConfig } from './domain';

const CONFIG_STORAGE_KEY = 'sciforge.config.v1';

export const defaultSciForgeConfig: SciForgeConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: 'http://127.0.0.1:18080',
  workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
  workspacePath: '/Applications/workspace/ailab/research/app/SciForge/workspace',
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
    return raw ? normalizeConfig(JSON.parse(raw)) : defaultSciForgeConfig;
  } catch {
    return defaultSciForgeConfig;
  }
}

export function saveSciForgeConfig(config: SciForgeConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
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

export function normalizeWorkspaceRootPath(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const marker = '/.sciforge/';
  const nestedIndex = trimmed.indexOf(marker);
  if (nestedIndex >= 0) return trimmed.slice(0, nestedIndex);
  if (trimmed.endsWith('/.sciforge')) return trimmed.slice(0, -'/.sciforge'.length);
  return trimmed;
}
