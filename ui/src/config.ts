import type { BioAgentConfig } from './domain';

const CONFIG_STORAGE_KEY = 'bioagent.config.v1';

export const defaultBioAgentConfig: BioAgentConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: 'http://127.0.0.1:18080',
  workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
  workspacePath: '/Applications/workspace/ailab/research/app/BioAgent',
  modelProvider: 'native',
  modelBaseUrl: '',
  modelName: '',
  apiKey: '',
  requestTimeoutMs: 300_000,
  updatedAt: new Date().toISOString(),
};

export function loadBioAgentConfig(): BioAgentConfig {
  if (typeof window === 'undefined') return defaultBioAgentConfig;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : defaultBioAgentConfig;
  } catch {
    return defaultBioAgentConfig;
  }
}

export function saveBioAgentConfig(config: BioAgentConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function normalizeConfig(value: unknown): BioAgentConfig {
  const raw = typeof value === 'object' && value !== null ? value as Partial<BioAgentConfig> : {};
  return {
    ...defaultBioAgentConfig,
    ...raw,
    schemaVersion: 1,
    agentServerBaseUrl: cleanUrl(raw.agentServerBaseUrl) || defaultBioAgentConfig.agentServerBaseUrl,
    workspaceWriterBaseUrl: cleanUrl(raw.workspaceWriterBaseUrl) || defaultBioAgentConfig.workspaceWriterBaseUrl,
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : defaultBioAgentConfig.workspacePath,
    modelProvider: typeof raw.modelProvider === 'string' ? raw.modelProvider : defaultBioAgentConfig.modelProvider,
    modelBaseUrl: cleanUrl(raw.modelBaseUrl) || '',
    modelName: typeof raw.modelName === 'string' ? raw.modelName : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    requestTimeoutMs: typeof raw.requestTimeoutMs === 'number' && Number.isFinite(raw.requestTimeoutMs)
      ? Math.max(30_000, Math.trunc(raw.requestTimeoutMs))
      : defaultBioAgentConfig.requestTimeoutMs,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

export function updateConfig(config: BioAgentConfig, patch: Partial<BioAgentConfig>): BioAgentConfig {
  return normalizeConfig({
    ...config,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function cleanUrl(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}
