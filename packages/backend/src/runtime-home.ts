import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_PROFILE = 'sciforge-runtime-deepseek';
export const RUNTIME_PROVIDER = 'sciforge-deepseek-proxy';
export const RUNTIME_MODEL = 'bailian/deepseek-v4-flash';
export const RUNTIME_KEY_ENV = 'SCIFORGE_RUNTIME_API_KEY';
export const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:3891/v1';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = join(backendRoot, '.codex-runtime');

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
  overwrite?: boolean;
};

export type RuntimeExecOptions = {
  workspace?: string;
  allowWorkspaceOutsideRuntimeRoot?: boolean;
};

export function getRuntimeHomePaths(): RuntimeHomePaths {
  const codexHome = join(runtimeRoot, 'codex-home');
  return {
    backendRoot,
    runtimeRoot,
    codexHome,
    configPath: join(codexHome, 'config.toml'),
    memoriesDir: join(codexHome, 'memories'),
    sessionsDir: join(codexHome, 'sessions'),
    logsDir: join(runtimeRoot, 'logs'),
    defaultWorkspace: join(runtimeRoot, 'workspaces', 'default'),
  };
}

export async function ensureRuntimeHome(options: RuntimeHomeOptions = {}): Promise<RuntimeHomePaths> {
  const paths = getRuntimeHomePaths();
  assertPathInside(paths.runtimeRoot, paths.backendRoot, 'runtime root');
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');

  await mkdir(paths.memoriesDir, { recursive: true });
  await mkdir(paths.sessionsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.defaultWorkspace, { recursive: true });

  const config = runtimeConfigToml(options.proxyBaseUrl ?? DEFAULT_PROXY_BASE_URL);
  if (options.overwrite || !(await fileExists(paths.configPath))) {
    await writeFile(paths.configPath, config, 'utf8');
  }
  return paths;
}

export async function readRuntimeConfig(path = getRuntimeHomePaths().configPath): Promise<string> {
  return readFile(path, 'utf8');
}

export function runtimeConfigToml(proxyBaseUrl = DEFAULT_PROXY_BASE_URL): string {
  return `model = "${RUNTIME_MODEL}"
profile = "${RUNTIME_PROFILE}"

[profiles.${RUNTIME_PROFILE}]
model = "${RUNTIME_MODEL}"
model_provider = "${RUNTIME_PROVIDER}"
model_reasoning_effort = "low"
model_reasoning_summary = "none"

[model_providers.${RUNTIME_PROVIDER}]
name = "SciForge DeepSeek Proxy"
base_url = "${proxyBaseUrl}"
env_key = "${RUNTIME_KEY_ENV}"
wire_api = "responses"

[features]
memories = true
prevent_idle_sleep = true
`;
}

export function resolveRuntimeWorkspace(options: RuntimeExecOptions = {}): string {
  const paths = getRuntimeHomePaths();
  const workspace = resolve(options.workspace ?? paths.defaultWorkspace);
  if (!options.allowWorkspaceOutsideRuntimeRoot) {
    assertPathInside(workspace, paths.runtimeRoot, 'runtime workspace');
  }
  return workspace;
}

export async function assertRuntimeReady(paths = getRuntimeHomePaths()): Promise<void> {
  assertPathInside(paths.codexHome, paths.runtimeRoot, 'runtime CODEX_HOME');
  const config = await readRuntimeConfig(paths.configPath);
  for (const required of [RUNTIME_PROFILE, RUNTIME_PROVIDER, RUNTIME_MODEL, RUNTIME_KEY_ENV, 'wire_api = "responses"']) {
    if (!config.includes(required)) {
      throw new Error(`Runtime Codex config is missing ${required}`);
    }
  }
  if (!process.env[RUNTIME_KEY_ENV]) {
    throw new Error(`Missing ${RUNTIME_KEY_ENV}; set it in the service environment, not in repository files.`);
  }
}

export function assertPathInside(child: string, parent: string, label: string): void {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  const rel = relative(resolvedParent, resolvedChild);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new Error(`${label} must stay inside ${resolvedParent}: ${resolvedChild}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
