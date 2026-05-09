import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';
import type { SciForgeConfig } from './domain';

export type { RuntimeHealthStatus } from '@sciforge-ui/runtime-contract';

export interface RuntimeHealthItem {
  id: 'ui' | 'workspace' | 'agentserver' | 'model' | 'library';
  label: string;
  status: RuntimeHealthStatus;
  detail: string;
  recoverAction?: string;
}

export function modelHealth(config: SciForgeConfig): RuntimeHealthItem {
  const provider = config.modelProvider.trim() || 'native';
  if (provider === 'native') {
    const nativeModel = config.modelName.trim();
    const nativeBaseUrl = config.modelBaseUrl.trim();
    const nativeApiKey = config.apiKey.trim();
    if (!nativeModel && !nativeBaseUrl && !nativeApiKey) {
      return {
        id: 'model',
        label: 'Model Backend',
        status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
        detail: 'native · user model not set',
        recoverAction: '填写用户侧 Model Name / Base URL / API Key；生成任务不会回退到 AgentServer 默认模型',
      };
    }
    return {
      id: 'model',
      label: 'Model Backend',
      status: RUNTIME_HEALTH_STATUS.ONLINE,
      detail: `native${nativeModel ? ` · ${nativeModel}` : ''}${nativeBaseUrl ? ` · ${nativeBaseUrl}` : ''}`,
    };
  }
  if (!config.modelBaseUrl.trim()) {
    return { id: 'model', label: 'Model Backend', status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED, detail: provider, recoverAction: '填写 Model Base URL 或切回 native' };
  }
  if (!config.apiKey.trim()) {
    return { id: 'model', label: 'Model Backend', status: RUNTIME_HEALTH_STATUS.NOT_CONFIGURED, detail: provider, recoverAction: '填写 API Key 或使用 native backend' };
  }
  return { id: 'model', label: 'Model Backend', status: RUNTIME_HEALTH_STATUS.ONLINE, detail: `${provider}${config.modelName.trim() ? ` · ${config.modelName.trim()}` : ''}` };
}
