import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import { defaultSciForgeConfig } from './config';
import type { RuntimeProviderPreflightManifest, SciForgeConfig } from './domain';
import type { RuntimeHealthItem } from './runtimeHealth';

export type ProviderReadinessState = 'ready' | 'partial' | 'blocked';

export interface ProviderReadinessNotice {
  ready: boolean;
  state: ProviderReadinessState;
  value: string;
  detail: string;
  recoverAction?: string;
  source: 'runtime-provider-preflight' | 'settings';
}

export function providerReadinessNoticeFromManifest(
  manifest: RuntimeProviderPreflightManifest | undefined,
  manifestError = '',
): ProviderReadinessNotice {
  if (!manifest) {
    return {
      ready: false,
      state: 'blocked',
      value: 'missing',
      detail: `Runtime provider preflight manifest is unavailable${manifestError ? `: ${manifestError}` : '.'}`,
      recoverAction: 'run npm run smoke:runtime-provider-preflight',
      source: 'runtime-provider-preflight',
    };
  }
  const missingEnv = manifest.missingEnv ?? [];
  const policyViolations = manifest.policyViolations ?? [];
  const ready = manifest.category === 'ready' && missingEnv.length === 0 && policyViolations.length === 0;
  const details = ready
    ? [`release=${manifest.releaseAcceptance}`, `evidence=${manifest.evidenceMode}`]
    : [
      `Runtime provider preflight category is ${manifest.category}`,
      missingEnv.length ? `missing env: ${missingEnv.join(', ')}` : '',
      policyViolations.length ? `policy violations: ${policyViolations.join(', ')}` : '',
      `releaseAcceptance=${manifest.releaseAcceptance}`,
    ];
  return {
    ready,
    state: ready ? 'ready' : 'partial',
    value: manifest.category,
    detail: details.filter(Boolean).join('; '),
    recoverAction: ready ? undefined : manifest.nextActions.find((action) => action.command)?.command,
    source: 'runtime-provider-preflight',
  };
}

export function providerReadinessNoticeFromConfig(config: SciForgeConfig): ProviderReadinessNotice {
  const provider = config.modelProvider.trim() || defaultSciForgeConfig.modelProvider;
  const model = config.modelName.trim() || (provider === defaultSciForgeConfig.modelProvider ? defaultSciForgeConfig.modelName : '');
  const baseUrl = config.modelBaseUrl.trim();
  const apiKeyConfigured = Boolean(config.apiKey.trim());
  if (provider === 'native') {
    if (!model && !baseUrl && !apiKeyConfigured) {
      return {
        ready: false,
        state: 'blocked',
        value: 'native',
        detail: 'native · user model not set',
        recoverAction: '填写 Model / Base URL / API Key；Runtime Codex 不会回退到其它 provider',
        source: 'settings',
      };
    }
    return {
      ready: true,
      state: 'ready',
      value: 'native',
      detail: `native${model ? ` · ${model}` : ''}${baseUrl ? ` · ${baseUrl}` : ''}`,
      source: 'settings',
    };
  }
  if (!baseUrl) {
    return {
      ready: false,
      state: 'blocked',
      value: provider,
      detail: provider,
      recoverAction: '填写 Base URL；默认应指向 packages/backend proxy',
      source: 'settings',
    };
  }
  if (!apiKeyConfigured) {
    return {
      ready: false,
      state: 'blocked',
      value: provider,
      detail: `${provider}${model ? ` · ${model}` : ''}`,
      recoverAction: '填写 API Key；allowOpenAiRuntime 默认 false，不会自动改用 OpenAI',
      source: 'settings',
    };
  }
  return {
    ready: true,
    state: 'ready',
    value: provider,
    detail: `${provider}${model ? ` · ${model}` : ''}`,
    source: 'settings',
  };
}

export function providerReadinessHealth(config: SciForgeConfig): RuntimeHealthItem {
  const notice = providerReadinessNoticeFromConfig(config);
  return {
    id: 'model',
    label: 'Model Provider',
    status: notice.ready ? RUNTIME_HEALTH_STATUS.ONLINE : RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
    detail: notice.detail,
    recoverAction: notice.recoverAction,
  };
}
