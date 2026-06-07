import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequiredLocalProviderSettings } from './local-provider-config.js';

export const RUNTIME_PROFILE = 'sciforge-runtime-default';
export const RUNTIME_PROVIDER = 'sciforge-model-router';
export const RUNTIME_MODEL = 'sciforge-router';
export const RUNTIME_KEY_ENV = 'SCIFORGE_RUNTIME_API_KEY';
export const RUNTIME_CODEX_SANDBOX_ENV = 'SCIFORGE_RUNTIME_CODEX_SANDBOX';
export const DEFAULT_RUNTIME_CODEX_SANDBOX = 'workspace-write';
export const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:3892/v1';
export type RuntimeCodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';
export const RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS = [
  '--config',
  'sandbox_workspace_write.network_access=true',
] as const;
export const RUNTIME_CODEX_DISABLE_PLUGIN_ARGS = [
  '--disable',
  'plugins',
  '--disable',
  'remote_plugin',
] as const;

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const devRuntimeRoot = join(backendRoot, '.codex-runtime');

export type RuntimeHomePaths = {
  backendRoot: string;
  runtimeRoot: string;
  codexHome: string;
  configPath: string;
  memoriesDir: string;
  sessionsDir: string;
  logsDir: string;
  defaultWorkspace: string;
};

export type RuntimeHomeOptions = {
  proxyBaseUrl?: string;
  provider?: string;
  providerName?: string;
  model?: string;
  overwrite?: boolean;
  paths?: RuntimeHomePathOptions;
};

export type RuntimeExecOptions = {
  workspace?: string;
  allowWorkspaceOutsideRuntimeRoot?: boolean;
  paths?: RuntimeHomePathOptions;
};

export type RuntimeReadyOptions = {
  env?: NodeJS.ProcessEnv;
  configLocalPath?: string;
};

export type RuntimeHomePathOptions = {
  runtimeRoot?: string;
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
};

export function getRuntimeHomePaths(options: RuntimeHomePathOptions = {}): RuntimeHomePaths {
  const env = options.env ?? process.env;
  const runtimeRoot = resolve(options.runtimeRoot ?? env.SCIFORGE_RUNTIME_ROOT ?? devRuntimeRoot);
  const codexHome = resolve(options.codexHome ?? env.SCIFORGE_RUNTIME_CODEX_HOME ?? join(runtimeRoot, 'codex-home'));
  const defaultWorkspace = resolve(env.SCIFORGE_RUNTIME_DEFAULT_WORKSPACE ?? join(runtimeRoot, 'workspaces', 'default'));
  return {
    backendRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace,
  };
}

export async function ensureRuntimeHome(options: RuntimeHomeOptions = {}): Promise<RuntimeHomePaths> {
  const paths = getRuntimeHomePaths(options.paths);
  if (!options.paths?.runtimeRoot && !options.paths?.env?.SCIFORGE_RUNTIME_ROOT && !process.env.SCIFORGE_RUNTIME_ROOT) {
    assertPathInside(paths.runtimeRoot, paths.backendRoot, 'runtime root');
  }
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');

  await mkdir(paths.memoriesDir, { recursive: true });
  await mkdir(paths.sessionsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.defaultWorkspace, { recursive: true });

  const config = runtimeConfigToml({
    proxyBaseUrl: options.proxyBaseUrl ?? DEFAULT_PROXY_BASE_URL,
    provider: options.provider ?? runtimeProviderForEnv(options.paths?.env),
    providerName: options.providerName,
    model: options.model ?? runtimeModelForEnv(options.paths?.env),
  });
  if (options.overwrite || await shouldWriteRuntimeConfig(paths.configPath, config)) {
    await writeFile(paths.configPath, config, 'utf8');
  }
  return paths;
}

export async function readRuntimeConfig(path = getRuntimeHomePaths().configPath): Promise<string> {
  return readFile(path, 'utf8');
}

export function runtimeConfigToml(input: string | {
  proxyBaseUrl?: string;
  provider?: string;
  providerName?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
} = DEFAULT_PROXY_BASE_URL): string {
  const options = typeof input === 'string' ? { proxyBaseUrl: input } : input;
  const proxyBaseUrl = options.proxyBaseUrl ?? DEFAULT_PROXY_BASE_URL;
  const provider = tomlBareKey(options.provider ?? runtimeProviderForEnv(options.env));
  const model = options.model?.trim() || runtimeModelForEnv(options.env);
  const providerName = options.providerName?.trim() || 'SciForge Model Router';
  return `model = "${tomlString(model)}"
profile = "${RUNTIME_PROFILE}"

[profiles.${RUNTIME_PROFILE}]
model = "${tomlString(model)}"
model_provider = "${provider}"
model_reasoning_effort = "low"
model_reasoning_summary = "none"

[model_providers.${provider}]
name = "${tomlString(providerName)}"
base_url = "${tomlString(proxyBaseUrl)}"
env_key = "${RUNTIME_KEY_ENV}"
wire_api = "responses"

[features]
memories = true
prevent_idle_sleep = true
plugins = false
remote_plugin = false

[sandbox_workspace_write]
network_access = true
`;
}

export function resolveRuntimeWorkspace(options: RuntimeExecOptions = {}): string {
  const paths = getRuntimeHomePaths(options.paths);
  const workspace = resolve(options.workspace ?? paths.defaultWorkspace);
  if (!options.allowWorkspaceOutsideRuntimeRoot) {
    assertPathInside(workspace, paths.runtimeRoot, 'runtime workspace');
  }
  return workspace;
}

export async function assertRuntimeReady(
  paths = getRuntimeHomePaths(),
  options: RuntimeReadyOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');
  resolveRuntimeCodexSandbox(env);
  const config = await readRuntimeConfig(paths.configPath);
  for (const required of [RUNTIME_PROFILE, RUNTIME_KEY_ENV, 'wire_api = "responses"']) {
    if (!config.includes(required)) {
      throw new Error(`Runtime Codex config is missing ${required}`);
    }
  }
  applyRuntimeKeyFromLocalProviderConfig(env, options.configLocalPath);
  const profileConfig = tableBlock(config, `profiles.${RUNTIME_PROFILE}`);
  const provider = valueForKey(profileConfig, 'model_provider') ?? valueForKey(config, 'model_provider');
  const model = valueForKey(profileConfig, 'model') ?? valueForKey(config, 'model');
  if (!provider) {
    throw new Error(`Runtime Codex profile ${RUNTIME_PROFILE} is missing model_provider.`);
  }
  if (!model) {
    throw new Error(`Runtime Codex profile ${RUNTIME_PROFILE} is missing model.`);
  }
  const proxyBaseUrl = valueForKey(tableBlock(config, `model_providers.${provider}`), 'base_url');
  if (!proxyBaseUrl) {
    throw new Error(`Runtime Codex provider ${provider} is missing proxy base_url.`);
  }
  if (env.SCIFORGE_ALLOW_OPENAI_RUNTIME !== '1' && /openai/i.test(`${provider}\n${model}\n${proxyBaseUrl}`)) {
    throw new Error('OpenAI Runtime Codex provider/model is disabled unless SCIFORGE_ALLOW_OPENAI_RUNTIME=1.');
  }
}

export function runtimeProviderForEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SCIFORGE_RUNTIME_PROVIDER?.trim();
  if (!configured || configured === 'native') return RUNTIME_PROVIDER;
  return configured;
}

export function runtimeModelForEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCIFORGE_RUNTIME_MODEL?.trim() || RUNTIME_MODEL;
}

export function resolveRuntimeCodexSandbox(env: NodeJS.ProcessEnv = process.env): RuntimeCodexSandbox {
  const value = env[RUNTIME_CODEX_SANDBOX_ENV]?.trim() || DEFAULT_RUNTIME_CODEX_SANDBOX;
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  throw new Error(
    `${RUNTIME_CODEX_SANDBOX_ENV} must be one of read-only, workspace-write, or danger-full-access; found ${value}.`,
  );
}

export function assertPathInside(child: string, parent: string, label: string): void {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  const rel = relative(resolvedParent, resolvedChild);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new Error(`${label} must stay inside ${resolvedParent}: ${resolvedChild}`);
}

async function shouldWriteRuntimeConfig(path: string, desiredConfig: string): Promise<boolean> {
  try {
    const currentConfig = await readFile(path, 'utf8');
    return !managedRuntimeConfigMatches(currentConfig, desiredConfig);
  } catch {
    return true;
  }
}

function managedRuntimeConfigMatches(currentConfig: string, desiredConfig: string): boolean {
  const current = runtimeConfigSignature(currentConfig);
  const desired = runtimeConfigSignature(desiredConfig);
  return current.profile === desired.profile
    && current.model === desired.model
    && current.provider === desired.provider
    && current.providerBaseUrl === desired.providerBaseUrl
    && current.providerEnvKey === desired.providerEnvKey
    && current.providerWireApi === desired.providerWireApi;
}

function applyRuntimeKeyFromLocalProviderConfig(env: NodeJS.ProcessEnv, configLocalPath?: string): void {
  const localConfigPath = resolve(configLocalPath ?? env.SCIFORGE_CONFIG_PATH?.trim() ?? 'config.local.json');
  const settings = readRequiredLocalProviderSettings(localConfigPath);
  if (!settings.apiKey) {
    throw new Error(`Missing ${RUNTIME_KEY_ENV}; configure apiKey, llm.apiKey, or codexProxy.apiKey in ${localConfigPath}.`);
  }
  env[RUNTIME_KEY_ENV] = settings.apiKey;
}

function runtimeConfigSignature(config: string) {
  const profile = valueForKey(config, 'profile');
  const profileConfig = profile ? tableBlock(config, `profiles.${profile}`) : '';
  const provider = valueForKey(profileConfig, 'model_provider') ?? valueForKey(config, 'model_provider');
  const providerConfig = provider ? tableBlock(config, `model_providers.${provider}`) : '';
  return {
    profile,
    model: valueForKey(profileConfig, 'model') ?? valueForKey(config, 'model'),
    provider,
    providerBaseUrl: valueForKey(providerConfig, 'base_url'),
    providerEnvKey: valueForKey(providerConfig, 'env_key'),
    providerWireApi: valueForKey(providerConfig, 'wire_api'),
  };
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

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tomlBareKey(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || RUNTIME_PROVIDER;
}
