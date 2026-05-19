import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';
import { DEFAULT_CODEX_RUNTIME_PROFILE, defaultSciForgeConfig } from './config';
import type { SciForgeConfig } from './domain';

export type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';

export interface RuntimeHealthItem {
  id: 'ui' | 'workspace' | 'codex-runtime' | 'agentserver' | 'model' | 'library';
  label: string;
  status: RuntimeHealthStatus;
  detail: string;
  recoverAction?: string;
}

export function workspaceWriterHealth(config: SciForgeConfig, workspaceOnline: boolean, defaultWorkspaceOnline = false): RuntimeHealthItem {
  if (workspaceOnline) {
    return { id: 'workspace', label: 'Workspace Writer', status: RUNTIME_HEALTH_STATUS.ONLINE, detail: config.workspaceWriterBaseUrl };
  }
  const defaultUrl = defaultSciForgeConfig.workspaceWriterBaseUrl;
  const configuredUrl = config.workspaceWriterBaseUrl.replace(/\/+$/, '');
  const defaultMatchesConfigured = configuredUrl === defaultUrl.replace(/\/+$/, '');
  const portDriftAction = !defaultMatchesConfigured && defaultWorkspaceOnline
    ? `当前 Workspace Writer URL 无法访问；默认 writer ${defaultUrl} 在线。打开 Settings 将 Workspace Writer URL 改回默认值后刷新。`
    : undefined;
  return {
    id: 'workspace',
    label: 'Workspace Writer',
    status: RUNTIME_HEALTH_STATUS.OFFLINE,
    detail: config.workspaceWriterBaseUrl,
    recoverAction: portDriftAction ?? '启动 npm run workspace:server 后刷新',
  };
}

export function modelHealth(config: SciForgeConfig): RuntimeHealthItem {
  const provider = config.modelProvider.trim() || defaultSciForgeConfig.modelProvider;
  const model = config.modelName.trim() || (provider === defaultSciForgeConfig.modelProvider ? defaultSciForgeConfig.modelName : '');
  const baseUrl = config.modelBaseUrl.trim();
  const apiKeyConfigured = Boolean(config.apiKey.trim());
  if (provider === 'native') {
    if (!model && !baseUrl && !apiKeyConfigured) {
      return {
        id: 'model',
        label: 'Model Provider',
        status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
        detail: 'native · user model not set',
        recoverAction: '填写 Model / Base URL / API Key；Runtime Codex 不会回退到其它 provider',
      };
    }
    return {
      id: 'model',
      label: 'Model Provider',
      status: RUNTIME_HEALTH_STATUS.ONLINE,
      detail: `native${model ? ` · ${model}` : ''}${baseUrl ? ` · ${baseUrl}` : ''}`,
    };
  }
  if (!baseUrl) {
    return { id: 'model', label: 'Model Provider', status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED, detail: provider, recoverAction: '填写 Base URL；默认应指向 packages/backend proxy' };
  }
  if (!apiKeyConfigured) {
    return { id: 'model', label: 'Model Provider', status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED, detail: `${provider} · ${model}`, recoverAction: '填写 API Key；allowOpenAiRuntime 默认 false，不会自动改用 OpenAI' };
  }
  return { id: 'model', label: 'Model Provider', status: RUNTIME_HEALTH_STATUS.ONLINE, detail: `${provider}${model ? ` · ${model}` : ''}` };
}

export function codexRuntimeHealth(config: SciForgeConfig, workspaceOnline: boolean): RuntimeHealthItem {
  const profile = config.runtimeProfile?.trim() || DEFAULT_CODEX_RUNTIME_PROFILE;
  if (!profile) {
    return {
      id: 'codex-runtime',
      label: 'Codex Runtime',
      status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
      detail: 'Runtime Profile missing',
      recoverAction: `配置 Runtime Profile，默认 ${DEFAULT_CODEX_RUNTIME_PROFILE}`,
    };
  }
  return {
    id: 'codex-runtime',
    label: 'Codex Runtime',
    status: workspaceOnline ? RUNTIME_HEALTH_STATUS.ONLINE : RUNTIME_HEALTH_STATUS.CHECKING,
    detail: `Runtime Profile ${profile}`,
    recoverAction: workspaceOnline ? undefined : '等待 Workspace Writer 暴露 Codex runtime bridge health',
  };
}
