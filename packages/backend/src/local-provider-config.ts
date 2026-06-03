import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LocalProviderSettings = {
  apiKey?: string;
  apiKeySource?: string;
  provider?: string;
  providerSource?: string;
  baseUrl?: string;
  baseUrlSource?: string;
  model?: string;
  modelSource?: string;
  forceNonStreamingUpstream?: boolean;
  forceNonStreamingUpstreamSource?: string;
  virtualAppScreenEnv?: Record<string, string>;
};

type SourceCandidate = {
  value: unknown;
  source: string;
};

export const LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS = [
  ['apiKey'],
  ['llm', 'apiKey'],
  ['llm', 'upstreamApiKey'],
  ['textLLM', 'apiKey'],
  ['textLLM', 'env', 'SCIFORGE_RUNTIME_API_KEY'],
  ['codexProxy', 'apiKey'],
  ['runtimeCodexProxy', 'apiKey'],
] as const;

const SAFE_VIRTUAL_APP_SCREEN_LOCAL_ENV_KEYS = new Set([
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_BUNDLE_ID',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_USER_MODEL_ID',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS',
]);

const VIRTUAL_APP_SCREEN_ENV_CANDIDATE_PATHS = [
  ['virtualAppScreen', 'env'],
  ['virtualAppScreen', 'nativeDriver', 'env'],
  ['computerUse', 'virtualAppScreen', 'env'],
  ['computerUse', 'virtualAppScreen', 'nativeDriver', 'env'],
] as const;

export function readLocalProviderSettings(path = 'config.local.json'): LocalProviderSettings {
  const configPath = resolve(path);
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    return localProviderSettings(parsed, { configPath });
  } catch {
    return {};
  }
}

export function providerEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return {
    ...(settings.apiKey ? { SCIFORGE_RUNTIME_API_KEY: settings.apiKey } : {}),
    ...(settings.provider ? { SCIFORGE_RUNTIME_PROVIDER: settings.provider } : {}),
    ...(settings.baseUrl ? { SCIFORGE_RUNTIME_BASE_URL: settings.baseUrl, SCIFORGE_PROXY_UPSTREAM_BASE_URL: settings.baseUrl } : {}),
    ...(settings.model ? { SCIFORGE_RUNTIME_MODEL: settings.model } : {}),
  };
}

export function virtualAppScreenEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return { ...(settings.virtualAppScreenEnv ?? {}) };
}

export function runtimeCodexEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return providerEnvFromLocalSettings(settings);
}

export function computerUseWorkspaceEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return {
    ...providerEnvFromLocalSettings(settings),
    ...virtualAppScreenEnvFromLocalSettings(settings),
  };
}

export function agentServerEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return {
    ...(settings.provider ? {
      AGENT_SERVER_MODEL_PROVIDER: settings.provider,
      AGENT_SERVER_ADAPTER_LLM_PROVIDER: settings.provider,
    } : {}),
    ...(settings.baseUrl ? {
      AGENT_SERVER_MODEL_BASE_URL: settings.baseUrl,
      AGENT_SERVER_ADAPTER_LLM_BASE_URL: settings.baseUrl,
    } : {}),
    ...(settings.apiKey ? {
      AGENT_SERVER_MODEL_API_KEY: settings.apiKey,
      AGENT_SERVER_ADAPTER_LLM_API_KEY: settings.apiKey,
    } : {}),
    ...(settings.model ? {
      AGENT_SERVER_MODEL: settings.model,
      AGENT_SERVER_MODEL_NAME: settings.model,
      AGENT_SERVER_ADAPTER_LLM_MODEL: settings.model,
    } : {}),
  };
}

export function localProviderSettings(
  config: unknown,
  options: { configPath?: string } = {},
): LocalProviderSettings {
  const root = isRecord(config) ? config : {};
  const prefix = options.configPath ? `${resolve(options.configPath)}:` : '';

  const apiKey = firstString([
    ...LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS
      .map((path) => candidate(root, path, prefix)),
  ]);
  const provider = firstString([
    candidate(root, ['runtimeProvider'], prefix),
    candidate(root, ['llm', 'provider'], prefix),
    candidate(root, ['textLLM', 'provider'], prefix),
    candidate(root, ['codexProxy', 'runtimeProvider'], prefix),
    candidate(root, ['codexProxy', 'provider'], prefix),
    candidate(root, ['runtimeCodexProxy', 'runtimeProvider'], prefix),
    candidate(root, ['runtimeCodexProxy', 'provider'], prefix),
  ]);
  const baseUrl = firstString([
    candidate(root, ['modelBaseUrl'], prefix),
    candidate(root, ['llm', 'baseUrl'], prefix),
    candidate(root, ['llm', 'upstreamBaseUrl'], prefix),
    candidate(root, ['textLLM', 'baseUrl'], prefix),
    candidate(root, ['textLLM', 'upstreamBaseUrl'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_COMPUTER_USE_TEXT_PLANNER_BASE_URL'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_RUNTIME_BASE_URL'], prefix),
    candidate(root, ['codexProxy', 'upstreamBaseUrl'], prefix),
    candidate(root, ['codexProxy', 'baseUrl'], prefix),
    candidate(root, ['runtimeCodexProxy', 'upstreamBaseUrl'], prefix),
    candidate(root, ['runtimeCodexProxy', 'baseUrl'], prefix),
  ], trimTrailingSlashes);
  const model = firstString([
    candidate(root, ['modelName'], prefix),
    candidate(root, ['llm', 'model'], prefix),
    candidate(root, ['llm', 'modelName'], prefix),
    candidate(root, ['llm', 'defaultModel'], prefix),
    candidate(root, ['textLLM', 'model'], prefix),
    candidate(root, ['textLLM', 'modelName'], prefix),
    candidate(root, ['codexProxy', 'defaultModel'], prefix),
    candidate(root, ['codexProxy', 'model'], prefix),
    candidate(root, ['runtimeCodexProxy', 'defaultModel'], prefix),
    candidate(root, ['runtimeCodexProxy', 'model'], prefix),
  ]);
  const forceNonStreamingUpstream = [
    candidate(root, ['codexProxy', 'forceNonStreamingUpstream'], prefix),
    candidate(root, ['runtimeCodexProxy', 'forceNonStreamingUpstream'], prefix),
  ].find((item) => item.value === true);
  const virtualAppScreenEnv = virtualAppScreenEnvFromConfig(root);

  return {
    ...(apiKey ? { apiKey: apiKey.value, apiKeySource: apiKey.source } : {}),
    ...(provider ? { provider: provider.value, providerSource: provider.source } : {}),
    ...(baseUrl ? { baseUrl: baseUrl.value, baseUrlSource: baseUrl.source } : {}),
    ...(model ? { model: model.value, modelSource: model.source } : {}),
    ...(forceNonStreamingUpstream ? {
      forceNonStreamingUpstream: true,
      forceNonStreamingUpstreamSource: forceNonStreamingUpstream.source,
    } : {}),
    ...(Object.keys(virtualAppScreenEnv).length ? { virtualAppScreenEnv } : {}),
  };
}

function candidate(root: unknown, path: readonly string[], prefix: string): SourceCandidate {
  return {
    value: valueAtPath(root, path),
    source: `${prefix}${path.join('.')}`,
  };
}

function firstString(
  candidates: SourceCandidate[],
  normalize: (value: string) => string = (value) => value,
): { value: string; source: string } | undefined {
  for (const item of candidates) {
    const value = stringValue(item.value);
    if (value) return { value: normalize(value), source: item.source };
  }
  return undefined;
}

function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function virtualAppScreenEnvFromConfig(root: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const path of VIRTUAL_APP_SCREEN_ENV_CANDIDATE_PATHS) {
    const block = valueAtPath(root, path);
    if (!isRecord(block)) continue;
    for (const [key, rawValue] of Object.entries(block)) {
      if (!SAFE_VIRTUAL_APP_SCREEN_LOCAL_ENV_KEYS.has(key)) continue;
      const value = localEnvStringValue(rawValue);
      if (value !== undefined) env[key] = value;
    }
  }
  return env;
}

function localEnvStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value.trim() : undefined;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (Array.isArray(value) || isRecord(value)) return JSON.stringify(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
