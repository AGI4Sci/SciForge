import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ProxyCliOptions = {
  host: string;
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  upstreamKeySource?: string;
  defaultModel?: string;
  quiet: boolean;
};

export function resolveProxyCliOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ProxyCliOptions {
  const get = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const configPath = get('--config') ?? env.SCIFORGE_CONFIG_PATH ?? 'config.local.json';
  const local = readLocalProxyConfig(configPath);
  const apiKeyEnv = get('--api-key-env') ?? env.SCIFORGE_PROXY_API_KEY_ENV ?? 'SCIFORGE_RUNTIME_API_KEY';
  const apiKeyFromEnv = stringValue(env[apiKeyEnv]);
  const apiKeyFromLocal = stringValue(local.apiKey);
  const upstreamApiKey = apiKeyFromEnv || apiKeyFromLocal || undefined;
  const upstreamBaseUrl = normalizeOpenAiCompatibleBaseUrl(
    get('--upstream-base-url')
    ?? env.SCIFORGE_PROXY_UPSTREAM_BASE_URL
    ?? stringValue(local.upstreamBaseUrl)
    ?? '',
  );

  return {
    host: get('--host') ?? env.SCIFORGE_PROXY_HOST ?? '127.0.0.1',
    port: Number(get('--port') ?? env.SCIFORGE_PROXY_PORT ?? 3891),
    upstreamBaseUrl,
    upstreamApiKey,
    upstreamKeySource: apiKeyFromEnv ? apiKeyEnv : apiKeyFromLocal ? `${configPath}:codexProxy.apiKey` : undefined,
    defaultModel: get('--default-model') ?? env.SCIFORGE_PROXY_DEFAULT_MODEL ?? stringValue(local.defaultModel),
    quiet: args.includes('--quiet') || env.SCIFORGE_PROXY_QUIET === '1',
  };
}

function readLocalProxyConfig(path: string) {
  const configPath = resolve(path);
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    const root = isRecord(parsed) ? parsed : {};
    const codexProxy = isRecord(root.codexProxy)
      ? root.codexProxy
      : isRecord(root.runtimeCodexProxy)
        ? root.runtimeCodexProxy
        : {};
    const llm = isRecord(root.llm) ? root.llm : {};
    return {
      upstreamBaseUrl: stringValue(codexProxy.upstreamBaseUrl)
        ?? stringValue(codexProxy.baseUrl)
        ?? stringValue(llm.upstreamBaseUrl)
        ?? stringValue(llm.baseUrl),
      apiKey: stringValue(codexProxy.apiKey) ?? stringValue(llm.upstreamApiKey) ?? stringValue(llm.apiKey),
      defaultModel: stringValue(codexProxy.defaultModel)
        ?? stringValue(codexProxy.model)
        ?? stringValue(llm.defaultModel)
        ?? stringValue(llm.model)
        ?? stringValue(llm.modelName),
    };
  } catch {
    return {};
  }
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
