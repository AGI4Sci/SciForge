import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';
import { DEFAULT_CODEX_RUNTIME_PROFILE, defaultSciForgeConfig } from './config';
import type { SciForgeConfig } from './domain';
import { providerReadinessHealth } from './providerReadiness';

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
  return providerReadinessHealth(config);
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
