import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';
import { DEFAULT_CODEX_RUNTIME_PROFILE, defaultSciForgeConfig } from './config';
import type { SciForgeConfig } from './domain';
import { providerReadinessHealth } from './providerReadiness';
import type { ProviderReadinessNotice } from './providerReadiness';
import { RUNTIME_MODULE_DISPATCHER_CAPABILITY } from './api/agentHostModuleClient';

export type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';

export interface RuntimeHealthItem {
  id: 'ui' | 'workspace' | 'codex-runtime' | 'agentserver' | 'model' | 'library';
  label: string;
  source?: 'settings' | 'runtime-provider-preflight';
  status: RuntimeHealthStatus;
  detail: string;
  recoverAction?: string;
  capabilities?: string[];
}

export interface WorkspaceWriterHealthProbe {
  online: boolean;
  service?: string;
  capabilities: string[];
}

export async function probeWorkspaceWriterHealthUrl(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  return (await probeWorkspaceWriterHealthDetailsUrl(url, options)).online;
}

export async function probeWorkspaceWriterHealthDetailsUrl(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<WorkspaceWriterHealthProbe> {
  const offline: WorkspaceWriterHealthProbe = { online: false, capabilities: [] };
  if (!url || !/^https?:\/\//.test(url)) return offline;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 1600);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return offline;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return offline;
    }
    if (!isRecord(json)) return offline;
    const service = typeof json.service === 'string' ? json.service : undefined;
    return {
      online: json.ok === true && service === 'sciforge-workspace-writer',
      service,
      capabilities: Array.isArray(json.capabilities) ? json.capabilities.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return offline;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function workspaceWriterHealth(
  config: SciForgeConfig,
  workspaceProbeOrOnline: WorkspaceWriterHealthProbe | boolean,
  defaultWorkspaceProbeOrOnline: WorkspaceWriterHealthProbe | boolean = false,
): RuntimeHealthItem {
  const workspaceProbe = normalizeWriterProbe(workspaceProbeOrOnline);
  const defaultWorkspaceProbe = normalizeWriterProbe(defaultWorkspaceProbeOrOnline);
  const workspaceOnline = workspaceProbe.online;
  if (workspaceOnline) {
    if (!workspaceProbe.capabilities.includes(RUNTIME_MODULE_DISPATCHER_CAPABILITY)) {
      return {
        id: 'workspace',
        label: 'Workspace Writer',
        status: RUNTIME_HEALTH_STATUS.OFFLINE,
        detail: workspaceWriterConfiguredDetail(config),
        recoverAction: `Workspace Writer 在线但缺少 ${RUNTIME_MODULE_DISPATCHER_CAPABILITY}；重启 npm run workspace:server 后刷新`,
        capabilities: boundedWorkspaceCapabilities(workspaceProbe.capabilities),
      };
    }
    return {
      id: 'workspace',
      label: 'Workspace Writer',
      status: RUNTIME_HEALTH_STATUS.ONLINE,
      detail: workspaceWriterConfiguredDetail(config),
      capabilities: boundedWorkspaceCapabilities(workspaceProbe.capabilities),
    };
  }
  const defaultUrl = defaultSciForgeConfig.workspaceWriterBaseUrl;
  const configuredUrl = config.workspaceWriterBaseUrl.replace(/\/+$/, '');
  const defaultMatchesConfigured = configuredUrl === defaultUrl.replace(/\/+$/, '');
  const portDriftAction = !defaultMatchesConfigured && defaultWorkspaceProbe.online
    ? '当前 Workspace Writer URL 无法访问；默认 writer 在线。打开 Settings 将 Workspace Writer URL 改回默认值后刷新。'
    : undefined;
  return {
    id: 'workspace',
    label: 'Workspace Writer',
    status: RUNTIME_HEALTH_STATUS.OFFLINE,
    detail: workspaceWriterConfiguredDetail(config),
    recoverAction: portDriftAction ?? '启动 npm run workspace:server 后刷新',
  };
}

function boundedWorkspaceCapabilities(value: string[]) {
  return value
    .filter((item) => item.trim().length > 0 && item.length <= 120)
    .map((item) => item.trim())
    .slice(0, 64);
}

function normalizeWriterProbe(value: WorkspaceWriterHealthProbe | boolean): WorkspaceWriterHealthProbe {
  return typeof value === 'boolean'
    ? { online: value, capabilities: value ? [RUNTIME_MODULE_DISPATCHER_CAPABILITY] : [] }
    : value;
}

export function modelHealth(config: SciForgeConfig, preflightNotice?: ProviderReadinessNotice): RuntimeHealthItem {
  return providerReadinessHealth(config, preflightNotice);
}

export function codexRuntimeHealth(config: SciForgeConfig, workspaceOnline: boolean): RuntimeHealthItem {
  const profile = config.runtimeProfile?.trim() || DEFAULT_CODEX_RUNTIME_PROFILE;
  if (!profile) {
    return {
      id: 'codex-runtime',
      label: 'Codex Runtime',
      status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
      detail: 'Runtime Profile missing',
      recoverAction: '配置 Runtime Profile。',
    };
  }
  return {
    id: 'codex-runtime',
    label: 'Codex Runtime',
    status: workspaceOnline ? RUNTIME_HEALTH_STATUS.ONLINE : RUNTIME_HEALTH_STATUS.CHECKING,
    detail: 'Runtime profile configured',
    recoverAction: workspaceOnline ? undefined : '等待 Workspace Writer 暴露 Codex runtime bridge health',
  };
}

function workspaceWriterConfiguredDetail(config: SciForgeConfig) {
  return config.workspaceWriterBaseUrl.trim()
    ? 'Workspace Writer configured (masked)'
    : 'Workspace Writer missing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
