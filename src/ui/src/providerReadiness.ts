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
  const provider = publicProviderAlias(config.modelProvider.trim() || defaultSciForgeConfig.modelProvider);
  if (provider === 'managed-runtime') {
    return {
      ready: true,
      state: 'ready',
      value: provider,
      detail: 'Managed Model Router configured',
      source: 'settings',
    };
  }
  return {
    ready: false,
    state: 'blocked',
    value: provider,
    detail: 'Only the managed Model Router provider is supported for runtime model calls.',
    recoverAction: 'Use the Model Router profile; keep provider API keys in config.local.json as Router member-model configuration.',
    source: 'settings',
  };
}

export function providerReadinessHealth(
  config: SciForgeConfig,
  preflightNotice?: ProviderReadinessNotice,
): RuntimeHealthItem {
  const notice = preflightNotice ?? providerReadinessNoticeFromConfig(config);
  return {
    id: 'model',
    label: notice.source === 'runtime-provider-preflight' ? 'Assistant Connection' : 'Model Provider',
    source: notice.source,
    status: notice.ready ? RUNTIME_HEALTH_STATUS.ONLINE : RUNTIME_HEALTH_STATUS.NOT_CONFIGURED,
    detail: providerHealthDetail(notice),
    recoverAction: notice.recoverAction,
  };
}

function providerHealthDetail(notice: ProviderReadinessNotice): string {
  if (notice.source !== 'runtime-provider-preflight') {
    return notice.ready
      ? notice.detail
      : notice.detail.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]').replace(/\/(?:Applications|Users|tmp)\/[^\s"',;)}\]]+/gi, '[redacted-path]');
  }
  if (notice.ready) return 'Assistant connection preflight ready';
  if (notice.value === 'missing') return 'Assistant connection preflight unavailable';
  return `Assistant connection preflight needs attention (${notice.value})`;
}

function publicProviderAlias(provider: string) {
  if (provider === 'native') return 'native';
  if (provider === 'openai-compatible') return 'openai-compatible';
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'codex-chatgpt') return 'codex-chatgpt';
  if (provider === 'gemini') return 'gemini';
  if (provider === defaultSciForgeConfig.modelProvider) return 'managed-runtime';
  return 'custom-provider';
}
