import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNTIME_MODEL, RUNTIME_PROFILE, RUNTIME_PROVIDER } from './runtime-home';

export type LocalProviderSettings = {
  apiKey?: string;
  apiKeySource?: string;
  provider?: string;
  providerSource?: string;
  baseUrl?: string;
  baseUrlSource?: string;
  model?: string;
  modelSource?: string;
  visionApiKey?: string;
  visionApiKeySource?: string;
  visionProvider?: string;
  visionProviderSource?: string;
  visionBaseUrl?: string;
  visionBaseUrlSource?: string;
  visionModel?: string;
  visionModelSource?: string;
  forceNonStreamingUpstream?: boolean;
  forceNonStreamingUpstreamSource?: string;
};

type SourceCandidate = {
  value: unknown;
  source: string;
};

export const LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS = [
  ['apiKey'],
  ['llm', 'apiKey'],
  ['llm', 'upstreamApiKey'],
  ['llm', 'env', 'SCIFORGE_TEXT_API_KEY'],
  ['textLLM', 'apiKey'],
  ['textLLM', 'env', 'SCIFORGE_TEXT_API_KEY'],
] as const;

export function defaultLocalProviderConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.SCIFORGE_CONFIG_PATH?.trim() || 'config.local.json');
}

export function readLocalProviderSettings(path = defaultLocalProviderConfigPath()): LocalProviderSettings {
  const configPath = resolve(path);
  if (!existsSync(configPath)) {
    throw new Error(`Missing config.local.json at ${configPath}; configure the local LLM upstream in config.local.json.`);
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    return localProviderSettings(parsed, { configPath });
  } catch (error) {
    throw new Error(`Invalid config.local.json at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readRequiredLocalProviderSettings(path = defaultLocalProviderConfigPath()): LocalProviderSettings {
  const configPath = resolve(path);
  if (!existsSync(configPath)) {
    throw new Error(`Missing config.local.json at ${configPath}; configure the local LLM upstream in config.local.json.`);
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    const settings = localProviderSettings(parsed, { configPath });
    assertRequiredLocalProviderSettings(settings, configPath);
    return settings;
  } catch (error) {
    throw new Error(`Invalid config.local.json at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function providerEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return {
    ...(settings.apiKey ? { SCIFORGE_TEXT_API_KEY: settings.apiKey } : {}),
    ...(settings.provider ? { SCIFORGE_TEXT_PROVIDER: settings.provider } : {}),
    ...(settings.baseUrl ? { SCIFORGE_TEXT_BASE_URL: settings.baseUrl } : {}),
    ...(settings.model ? { SCIFORGE_TEXT_MODEL: settings.model } : {}),
    ...(settings.visionApiKey ? { SCIFORGE_VISION_API_KEY: settings.visionApiKey } : {}),
    ...(settings.visionProvider ? { SCIFORGE_VISION_PROVIDER: settings.visionProvider } : {}),
    ...(settings.visionBaseUrl ? { SCIFORGE_VISION_BASE_URL: settings.visionBaseUrl } : {}),
    ...(settings.visionModel ? { SCIFORGE_VISION_MODEL: settings.visionModel } : {}),
  };
}

export function runtimeCodexEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return {
    SCIFORGE_RUNTIME_API_KEY: 'sciforge-local-model-router',
    SCIFORGE_RUNTIME_PROVIDER: RUNTIME_PROVIDER,
    SCIFORGE_RUNTIME_MODEL: RUNTIME_MODEL,
    SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: RUNTIME_MODEL,
    SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE: RUNTIME_PROFILE,
  };
}

export function computerUseWorkspaceEnvFromLocalSettings(settings: LocalProviderSettings): Record<string, string> {
  return runtimeCodexEnvFromLocalSettings(settings);
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
    candidate(root, ['provider'], prefix),
    candidate(root, ['llm', 'provider'], prefix),
    candidate(root, ['llm', 'env', 'SCIFORGE_TEXT_PROVIDER'], prefix),
    candidate(root, ['textLLM', 'provider'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_TEXT_PROVIDER'], prefix),
  ]);
  const baseUrl = firstString([
    candidate(root, ['modelBaseUrl'], prefix),
    candidate(root, ['baseUrl'], prefix),
    candidate(root, ['upstreamBaseUrl'], prefix),
    candidate(root, ['llm', 'baseUrl'], prefix),
    candidate(root, ['llm', 'upstreamBaseUrl'], prefix),
    candidate(root, ['llm', 'env', 'SCIFORGE_TEXT_BASE_URL'], prefix),
    candidate(root, ['textLLM', 'baseUrl'], prefix),
    candidate(root, ['textLLM', 'upstreamBaseUrl'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_TEXT_BASE_URL'], prefix),
  ], normalizeOpenAiCompatibleBaseUrl);
  const model = firstString([
    candidate(root, ['modelName'], prefix),
    candidate(root, ['model'], prefix),
    candidate(root, ['defaultModel'], prefix),
    candidate(root, ['llm', 'model'], prefix),
    candidate(root, ['llm', 'modelName'], prefix),
    candidate(root, ['llm', 'defaultModel'], prefix),
    candidate(root, ['llm', 'env', 'SCIFORGE_TEXT_MODEL'], prefix),
    candidate(root, ['textLLM', 'model'], prefix),
    candidate(root, ['textLLM', 'modelName'], prefix),
    candidate(root, ['textLLM', 'env', 'SCIFORGE_TEXT_MODEL'], prefix),
  ]);
  const visionProvider = firstString([
    candidate(root, ['visionLLM', 'provider'], prefix),
    candidate(root, ['visionLLM', 'runtimeProvider'], prefix),
    candidate(root, ['visionSense', 'provider'], prefix),
    candidate(root, ['visionSense', 'runtimeProvider'], prefix),
  ]);
  const visionApiKey = firstString([
    candidate(root, ['visionLLM', 'apiKey'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_API_KEY'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_VLM_API_KEY'], prefix),
    candidate(root, ['visionSense', 'apiKey'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_API_KEY'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_VLM_API_KEY'], prefix),
  ]);
  const visionBaseUrl = firstString([
    candidate(root, ['visionLLM', 'baseUrl'], prefix),
    candidate(root, ['visionLLM', 'upstreamBaseUrl'], prefix),
    candidate(root, ['visionLLM', 'modelBaseUrl'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_BASE_URL'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_VLM_BASE_URL'], prefix),
    candidate(root, ['visionSense', 'vlmBaseUrl'], prefix),
    candidate(root, ['visionSense', 'baseUrl'], prefix),
    candidate(root, ['visionSense', 'modelBaseUrl'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_BASE_URL'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_VLM_BASE_URL'], prefix),
  ], normalizeOpenAiCompatibleBaseUrl);
  const visionModel = firstString([
    candidate(root, ['visionLLM', 'model'], prefix),
    candidate(root, ['visionLLM', 'modelName'], prefix),
    candidate(root, ['visionLLM', 'defaultModel'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_MODEL'], prefix),
    candidate(root, ['visionLLM', 'env', 'SCIFORGE_VISION_VLM_MODEL'], prefix),
    candidate(root, ['visionSense', 'vlmModel'], prefix),
    candidate(root, ['visionSense', 'model'], prefix),
    candidate(root, ['visionSense', 'modelName'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_MODEL'], prefix),
    candidate(root, ['visionSense', 'env', 'SCIFORGE_VISION_VLM_MODEL'], prefix),
  ]);
  return {
    ...(apiKey ? { apiKey: apiKey.value, apiKeySource: apiKey.source } : {}),
    ...(provider ? { provider: provider.value, providerSource: provider.source } : {}),
    ...(baseUrl ? { baseUrl: baseUrl.value, baseUrlSource: baseUrl.source } : {}),
    ...(model ? { model: model.value, modelSource: model.source } : {}),
    ...(visionApiKey ? { visionApiKey: visionApiKey.value, visionApiKeySource: visionApiKey.source } : {}),
    ...(visionProvider ? { visionProvider: visionProvider.value, visionProviderSource: visionProvider.source } : {}),
    ...(visionBaseUrl ? { visionBaseUrl: visionBaseUrl.value, visionBaseUrlSource: visionBaseUrl.source } : {}),
    ...(visionModel ? { visionModel: visionModel.value, visionModelSource: visionModel.source } : {}),
  };
}

function assertRequiredLocalProviderSettings(settings: LocalProviderSettings, configPath: string): void {
  const missing = [
    settings.apiKey ? undefined : 'apiKey',
    settings.baseUrl ? undefined : 'baseUrl',
    settings.model ? undefined : 'model',
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    throw new Error(`${configPath} is missing required local LLM upstream config: ${missing.join(', ')}.`);
  }
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

function normalizeOpenAiCompatibleBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
