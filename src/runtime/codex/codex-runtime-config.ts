import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ensureRuntimeHome,
  getRuntimeHomePaths,
  readRuntimeConfig,
  RUNTIME_KEY_ENV,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
  RUNTIME_PROVIDER,
} from '../../../packages/backend/src/runtime-home.js';

export interface CodexRuntimeConfig {
  codexHome: string;
  configPath: string;
  provider: string;
  model: string;
  profile: string;
  workspace: string;
  allowOpenAiRuntime: boolean;
  capabilities: string[];
  roleCoverage: {
    textReasoner: 'configured';
    visionTranslator: 'configured';
  };
  readiness: 'configured';
}

export interface RuntimeConfigGuardOptions {
  workspacePath: string;
  profile?: string;
  allowOpenAiRuntime?: boolean;
  env?: NodeJS.ProcessEnv;
  configText?: string;
}

export async function assertCodexRuntimeConfig(options: RuntimeConfigGuardOptions): Promise<CodexRuntimeConfig> {
  const env = options.env ?? process.env;
  const paths = getRuntimeHomePaths({ env });
  const profile = options.profile ?? RUNTIME_PROFILE;
  if (profile !== RUNTIME_PROFILE) {
    throw new Error(`Unsupported Runtime Codex profile: ${profile}. Expected ${RUNTIME_PROFILE}.`);
  }

  const workspace = resolve(options.workspacePath || '');
  if (!workspace || workspace === resolve('/')) {
    throw new Error('Runtime Codex workspace is required.');
  }
  const workspaceStat = await stat(workspace).catch(() => undefined);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`Runtime Codex workspace does not exist or is not a directory: ${workspace}`);
  }

  if (options.configText === undefined) {
    await ensureRuntimeHome({
      proxyBaseUrl: runtimeProviderBaseUrlForEnv(env),
      paths: { env },
    });
  }

  await access(paths.codexHome).catch(() => {
    throw new Error(`Runtime Codex CODEX_HOME is missing: ${paths.codexHome}`);
  });
  const configText = options.configText ?? await readRuntimeConfig(paths.configPath);
  const profileConfig = profileBlock(configText, RUNTIME_PROFILE);
  const provider = valueForKey(profileConfig, 'model_provider') ?? valueForKey(configText, 'model_provider');
  const model = valueForKey(profileConfig, 'model') ?? valueForKey(configText, 'model');

  if (!configText.includes(`[profiles.${RUNTIME_PROFILE}]`)) {
    throw new Error(`Runtime Codex config is missing profile ${RUNTIME_PROFILE}.`);
  }
  if (!provider) {
    throw new Error(`Runtime Codex profile ${RUNTIME_PROFILE} is missing model_provider.`);
  }
  if (!model) {
    throw new Error(`Runtime Codex profile ${RUNTIME_PROFILE} is missing model.`);
  }
  const providerConfig = providerBlock(configText, provider);
  const proxyBaseUrl = valueForKey(providerConfig, 'base_url');
  const envKey = valueForKey(providerConfig, 'env_key');
  if (!proxyBaseUrl) {
    throw new Error(`Runtime Codex provider ${provider} is missing proxy base_url.`);
  }
  if (envKey !== RUNTIME_KEY_ENV) {
    throw new Error(`Runtime Codex provider ${provider} must use env_key ${RUNTIME_KEY_ENV}.`);
  }
  if (!env[RUNTIME_KEY_ENV]) {
    throw new Error(`Missing ${RUNTIME_KEY_ENV}; Runtime Codex fails closed without a configured provider key.`);
  }
  const allowOpenAiRuntime = options.allowOpenAiRuntime === true;
  if (!allowOpenAiRuntime && /openai/i.test(`${provider}\n${model}\n${proxyBaseUrl}`)) {
    throw new Error('OpenAI Runtime Codex provider/model is disabled unless allowOpenAiRuntime=true.');
  }

  return {
    codexHome: paths.codexHome,
    configPath: paths.configPath,
    provider: publicRuntimeProvider(provider),
    model: publicRuntimeModel(model),
    profile,
    workspace,
    allowOpenAiRuntime,
    capabilities: ['text', 'vision'],
    roleCoverage: {
      textReasoner: 'configured',
      visionTranslator: 'configured',
    },
    readiness: 'configured',
  };
}

export function codexRuntimeEnv(baseEnv: NodeJS.ProcessEnv, codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, CODEX_HOME: codexHome };
  delete env.CODEX_USER_HOME;
  delete env.CODEX_CONFIG_HOME;
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY);
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy);
  for (const key of Object.keys(env)) {
    if (key.startsWith('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_')) delete env[key];
  }
  return env;
}

function appendNoProxyLoopbacks(value: string | undefined): string {
  const required = ['127.0.0.1', 'localhost', '::1'];
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const existing = new Set(parts.map((part) => part.toLowerCase()));
  for (const entry of required) {
    if (!existing.has(entry.toLowerCase())) parts.push(entry);
  }
  return parts.join(',');
}

function runtimeProviderBaseUrlForEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = [
    env.SCIFORGE_PROXY_BASE_URL,
    env.SCIFORGE_PROXY_URL,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim()
    ?? runtimeProviderServiceUrlForPortEnv(env);
  if (!value) return undefined;
  const trimmed = value
    .replace(/[?#].*$/, '')
    .replace(/\/(?:healthz|health)\/?$/i, '')
    .replace(/\/v1\/responses\/?$/i, '/v1')
    .replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function runtimeProviderServiceUrlForPortEnv(env: NodeJS.ProcessEnv): string | undefined {
  const port = runtimeProxyPortForEnv(env);
  if (!port) return undefined;
  const host = [
    env.SCIFORGE_PROXY_HOST,
    env.SCIFORGE_MODEL_ROUTER_HOST,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() || '127.0.0.1';
  return `http://${host}:${port}`;
}

function runtimeProxyPortForEnv(env: NodeJS.ProcessEnv): string | undefined {
  for (const value of [env.SCIFORGE_PROXY_PORT, env.SCIFORGE_MODEL_ROUTER_PORT]) {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return String(port);
  }
  return undefined;
}

function profileBlock(config: string, profile: string): string {
  return tableBlock(config, `profiles.${profile}`);
}

function providerBlock(config: string, provider: string): string {
  return tableBlock(config, `model_providers.${provider}`);
}

function publicRuntimeProvider(provider: string): string {
  return isSafePublicRuntimeAlias(provider, RUNTIME_PROVIDER)
    ? provider
    : RUNTIME_PROVIDER;
}

function publicRuntimeModel(model: string): string {
  return isSafePublicRuntimeAlias(model, RUNTIME_MODEL)
    ? model
    : RUNTIME_MODEL;
}

const privateRuntimeAliasTokenPattern = /\b(?:deepseek|qwen|bailian|dashscope|openai|gpt|claude|gemini|proxy|provider|model|chat)\b/i;

function isSafePublicRuntimeAlias(value: string, baseAlias: string) {
  if (value === baseAlias) return true;
  const prefix = `${baseAlias}-`;
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  return /^[a-z0-9-]{1,64}$/i.test(suffix) && !privateRuntimeAliasTokenPattern.test(suffix);
}

function tableBlock(config: string, table: string): string {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) return '';
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*\[/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

function valueForKey(config: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]+)"`, 'm').exec(config);
  return match?.[1];
}
