import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { buildDesktopNativeReadiness, type DesktopNativeReadiness } from '../src/desktop/native-readiness.js';

export type DesktopDevShellProcessId = 'vite' | 'workspace-writer' | 'model-router' | 'runtime-codex' | 'electron';
const MODEL_ROUTER_PUBLIC_MODEL_ALIAS = 'sciforge-router';
const MODEL_ROUTER_DEFAULT_PROFILE = 'sciforge-runtime-default';
const MODEL_ROUTER_LOCAL_RUNTIME_API_KEY = 'sciforge-local-model-router';
export const DESKTOP_DEV_DEFAULT_BROWSER_HOST_NATIVE_ADAPTER_URL = 'http://127.0.0.1:5177';
const LEGACY_RUNTIME_DIRECT_ENV_KEYS = [
  'SCIFORGE_RUNTIME_BASE_URL',
] as const;
const ROUTER_MEMBER_ENV_KEYS = [
  'SCIFORGE_TEXT_PROVIDER',
  'SCIFORGE_TEXT_BASE_URL',
  'SCIFORGE_TEXT_MODEL',
  'SCIFORGE_TEXT_API_KEY',
  'SCIFORGE_TEXT_API_KEY_ENV',
  'SCIFORGE_VISION_PROVIDER',
  'SCIFORGE_VISION_BASE_URL',
  'SCIFORGE_VISION_MODEL',
  'SCIFORGE_VISION_API_KEY',
  'SCIFORGE_VISION_API_KEY_ENV',
  'SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS',
] as const;
const RUNTIME_ROUTER_ENV_KEYS = [
  'SCIFORGE_RUNTIME_API_KEY',
  'SCIFORGE_MODEL_ROUTER_API_KEY',
  'SCIFORGE_RUNTIME_MODEL',
  'SCIFORGE_MODEL_ROUTER_BASE_URL',
] as const;
const FRONTEND_ENV_UNSET_KEYS = [
  ...LEGACY_RUNTIME_DIRECT_ENV_KEYS,
  ...ROUTER_MEMBER_ENV_KEYS,
  ...RUNTIME_ROUTER_ENV_KEYS,
] as const;

export type DesktopDevShellProcessPlan = {
  id: DesktopDevShellProcessId;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type DesktopDevShellPlan = {
  schemaVersion: 'sciforge.desktop.dev-shell-plan.v1';
  projectRoot: string;
  workspacePath: string;
  renderer: {
    kind: 'vite-dev-server';
    url: string;
    hotReload: true;
  };
  electron: {
    rendererLoad: 'loadURL-vite-dev-server';
    nativeAdapterInjected: boolean;
  };
  processes: DesktopDevShellProcessPlan[];
  diagnostics: {
    nativeReadiness: DesktopNativeReadiness;
    config: {
      source: string | null;
      memberCredentialSource: 'env' | 'config' | 'missing';
      textBaseUrlConfigured: boolean;
      textModelConfigured: boolean;
      visionModelConfigured: boolean;
    };
  };
};

export type DesktopDevShellCreatePlanOptions = {
  projectRoot?: string;
  workspacePath?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  nativeAdapterUrl?: string;
  rendererUrl?: string;
  workspaceWriterUrl?: string;
  modelRouterUrl?: string;
  runtimeCodexUrl?: string;
};

export type DesktopDevShellChild = {
  pid?: number;
  stdout?: Readable;
  stderr?: Readable;
  killed?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type DesktopDevShellSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => DesktopDevShellChild;

export type DesktopDevShellControllerOptions = DesktopDevShellCreatePlanOptions & {
  spawnProcess?: DesktopDevShellSpawn;
};

export type DesktopDevShellStarted = {
  plan: DesktopDevShellPlan;
  processes: DesktopDevShellProcessPlan[];
};

export function createDesktopDevShellPlan(options: DesktopDevShellCreatePlanOptions = {}): DesktopDevShellPlan {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const workspacePath = resolve(options.workspacePath ?? join(projectRoot, '.sciforge-desktop-dev', 'workspace'));
  const env = options.env ?? process.env;
  const configPath = resolve(options.configPath ?? env.SCIFORGE_CONFIG_PATH ?? join(projectRoot, 'config.local.json'));
  const config = readDesktopDevShellConfig(configPath);
  const rendererUrl = sanitizeLoopbackHttpUrl(options.rendererUrl ?? 'http://127.0.0.1:5173') ?? 'http://127.0.0.1:5173';
  const workspaceWriterUrl = sanitizeLoopbackHttpUrl(options.workspaceWriterUrl ?? 'http://127.0.0.1:5174') ?? 'http://127.0.0.1:5174';
  const modelRouterUrl = firstSanitizedLoopbackHttpUrl([
    options.modelRouterUrl,
    env.SCIFORGE_MODEL_ROUTER_BASE_URL,
    env.SCIFORGE_MODEL_ROUTER_URL,
    loopbackHttpUrlFromPort(env.SCIFORGE_MODEL_ROUTER_PORT),
    'http://127.0.0.1:5175',
  ]) ?? 'http://127.0.0.1:5175';
  const modelRouterOpenAiBaseUrl = openAiBaseUrl(modelRouterUrl);
  const runtimeCodexUrl = sanitizeLoopbackHttpUrl(options.runtimeCodexUrl ?? 'http://127.0.0.1:5176') ?? 'http://127.0.0.1:5176';
  const nativeAdapterUrl = firstSanitizedLoopbackHttpUrl([
    options.nativeAdapterUrl,
    env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL,
    config.browserHostNativeAdapterUrl,
    DESKTOP_DEV_DEFAULT_BROWSER_HOST_NATIVE_ADAPTER_URL,
  ]);
  const routerPublicModelAlias = stringValue(env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)
    ?? MODEL_ROUTER_PUBLIC_MODEL_ALIAS;
  const routerProfile = stringValue(env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE)
    ?? MODEL_ROUTER_DEFAULT_PROFILE;
  const runtimeApiKey = stringValue(env.SCIFORGE_MODEL_ROUTER_API_KEY)
    ?? stringValue(env.SCIFORGE_RUNTIME_API_KEY)
    ?? MODEL_ROUTER_LOCAL_RUNTIME_API_KEY;
  const textProvider = stringValue(env.SCIFORGE_TEXT_PROVIDER) ?? config.textProvider;
  const textBaseUrl = stringValue(env.SCIFORGE_TEXT_BASE_URL) ?? config.textBaseUrl;
  const textModel = stringValue(env.SCIFORGE_TEXT_MODEL) ?? config.textModel;
  const textApiKey = stringValue(env.SCIFORGE_TEXT_API_KEY) ?? config.textApiKey;
  const textApiKeyEnv = stringValue(env.SCIFORGE_TEXT_API_KEY_ENV);
  const visionModel = stringValue(env.SCIFORGE_VISION_MODEL) ?? config.visionModel;
  const visionProvider = visionModel
    ? stringValue(env.SCIFORGE_VISION_PROVIDER) ?? config.visionProvider ?? textProvider
    : undefined;
  const visionBaseUrl = visionModel
    ? stringValue(env.SCIFORGE_VISION_BASE_URL) ?? config.visionBaseUrl ?? textBaseUrl
    : undefined;
  const visionApiKey = visionModel
    ? stringValue(env.SCIFORGE_VISION_API_KEY) ?? config.visionApiKey ?? textApiKey
    : undefined;
  const visionApiKeyEnv = visionModel ? stringValue(env.SCIFORGE_VISION_API_KEY_ENV) : undefined;
  const visionMaxSupplementRounds = visionModel ? stringValue(env.SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS) : undefined;
  const memberCredentialFromEnv = Boolean(
    stringValue(env.SCIFORGE_TEXT_API_KEY)
    || stringValue(env.SCIFORGE_VISION_API_KEY),
  );
  const memberCredentialFromConfig = Boolean(config.textApiKey || config.visionApiKey);

  const sidecarEnv: NodeJS.ProcessEnv = withUnsetEnv(compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    SCIFORGE_RUNTIME_DEFAULT_WORKSPACE: workspacePath,
    SCIFORGE_WORKSPACE_WRITER_URL: workspaceWriterUrl,
    SCIFORGE_MODEL_ROUTER_BASE_URL: modelRouterOpenAiBaseUrl,
    SCIFORGE_MODEL_ROUTER_HOST: '127.0.0.1',
    SCIFORGE_MODEL_ROUTER_PORT: portFromUrl(modelRouterUrl),
    SCIFORGE_RUNTIME_CODEX_URL: runtimeCodexUrl,
    SCIFORGE_WORKSPACE_PORT: portFromUrl(workspaceWriterUrl),
    SCIFORGE_RUNTIME_CODEX_HOST: '127.0.0.1',
    SCIFORGE_RUNTIME_CODEX_PORT: portFromUrl(runtimeCodexUrl),
    ...(nativeAdapterUrl ? { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: nativeAdapterUrl } : {}),
    SCIFORGE_RUNTIME_API_KEY: runtimeApiKey,
    SCIFORGE_MODEL_ROUTER_API_KEY: runtimeApiKey,
    SCIFORGE_RUNTIME_MODEL: routerPublicModelAlias,
    SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: routerPublicModelAlias,
    SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE: routerProfile,
  }), LEGACY_RUNTIME_DIRECT_ENV_KEYS);
  const routerMemberEnv: NodeJS.ProcessEnv = compactEnv({
    ...(textProvider ? { SCIFORGE_TEXT_PROVIDER: textProvider } : {}),
    ...(textBaseUrl ? { SCIFORGE_TEXT_BASE_URL: textBaseUrl } : {}),
    ...(textModel ? { SCIFORGE_TEXT_MODEL: textModel } : {}),
    ...(textApiKey ? { SCIFORGE_TEXT_API_KEY: textApiKey } : {}),
    ...(textApiKeyEnv ? { SCIFORGE_TEXT_API_KEY_ENV: textApiKeyEnv } : {}),
    ...(visionProvider ? { SCIFORGE_VISION_PROVIDER: visionProvider } : {}),
    ...(visionBaseUrl ? { SCIFORGE_VISION_BASE_URL: visionBaseUrl } : {}),
    ...(visionModel ? { SCIFORGE_VISION_MODEL: visionModel } : {}),
    ...(visionApiKey ? { SCIFORGE_VISION_API_KEY: visionApiKey } : {}),
    ...(visionApiKeyEnv ? { SCIFORGE_VISION_API_KEY_ENV: visionApiKeyEnv } : {}),
    ...(visionMaxSupplementRounds ? { SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS: visionMaxSupplementRounds } : {}),
  });
  const nonRouterSidecarEnv = withUnsetEnv(sidecarEnv, ROUTER_MEMBER_ENV_KEYS);
  const modelRouterEnv = { ...sidecarEnv, ...routerMemberEnv };
  const rendererEnv: NodeJS.ProcessEnv = withUnsetEnv(compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: workspaceWriterUrl,
  }), FRONTEND_ENV_UNSET_KEYS);
  const electronEnv: NodeJS.ProcessEnv = withUnsetEnv(compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    SCIFORGE_DESKTOP_APP_ROOT: projectRoot,
    SCIFORGE_DESKTOP_RENDERER_URL: rendererUrl,
    SCIFORGE_DESKTOP_WORKSPACE_PATH: workspacePath,
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    ...(nativeAdapterUrl ? { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: nativeAdapterUrl } : {}),
  }), FRONTEND_ENV_UNSET_KEYS);

  const processes: DesktopDevShellProcessPlan[] = [
    {
      id: 'vite',
      command: 'npm',
      args: ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', portFromUrl(rendererUrl)],
      cwd: projectRoot,
      env: rendererEnv,
    },
    {
      id: 'workspace-writer',
      command: 'npm',
      args: ['run', 'workspace:server', '--', '--host', '127.0.0.1', '--port', portFromUrl(workspaceWriterUrl)],
      cwd: projectRoot,
      env: nonRouterSidecarEnv,
    },
    {
      id: 'model-router',
      command: 'npm',
      args: [
        'run',
        'backend:model-router',
        '--',
        '--quiet',
        '--host',
        '127.0.0.1',
        '--port',
        portFromUrl(modelRouterUrl),
        '--workspace-root',
        workspacePath,
      ],
      cwd: projectRoot,
      env: modelRouterEnv,
    },
    {
      id: 'runtime-codex',
      command: 'npm',
      args: ['run', 'backend:codex-runtime:server'],
      cwd: projectRoot,
      env: nonRouterSidecarEnv,
    },
    {
      id: 'electron',
      command: 'npx',
      args: ['electron', 'dist-desktop/src/desktop/main.js'],
      cwd: projectRoot,
      env: electronEnv,
    },
  ];

  return {
    schemaVersion: 'sciforge.desktop.dev-shell-plan.v1',
    projectRoot,
    workspacePath,
    renderer: {
      kind: 'vite-dev-server',
      url: rendererUrl,
      hotReload: true,
    },
    electron: {
      rendererLoad: 'loadURL-vite-dev-server',
      nativeAdapterInjected: Boolean(nativeAdapterUrl),
    },
    processes,
    diagnostics: {
      nativeReadiness: buildDesktopNativeReadiness({
        adapterUrl: nativeAdapterUrl,
        refs: {
          browser: ['desktop-native:browser/readiness.json'],
          annotation: ['desktop-native:annotation/readiness.json'],
          image: ['desktop-native:image/readiness.json'],
          windowAction: ['desktop-native:window-action/readiness.json'],
        },
        capabilities: {
          browser: { available: Boolean(nativeAdapterUrl), ready: Boolean(nativeAdapterUrl) },
          annotation: { available: false, ready: false, reason: 'annotation native overlay not started by dev shell plan' },
          image: { available: false, ready: false, reason: 'image native adapter not started by dev shell plan' },
          windowAction: { available: false, ready: false, reason: 'window action native adapter not started by dev shell plan' },
        },
      }),
      config: {
        source: config.source,
        memberCredentialSource: memberCredentialFromEnv ? 'env' : memberCredentialFromConfig ? 'config' : 'missing',
        textBaseUrlConfigured: Boolean(textBaseUrl),
        textModelConfigured: Boolean(textModel),
        visionModelConfigured: Boolean(visionModel),
      },
    },
  };
}

export class DesktopDevShellController {
  private children: DesktopDevShellChild[] = [];
  private plan?: DesktopDevShellPlan;

  constructor(private readonly options: DesktopDevShellControllerOptions = {}) {}

  async start(): Promise<DesktopDevShellStarted> {
    if (this.plan) return { plan: this.plan, processes: this.plan.processes };
    const plan = createDesktopDevShellPlan(this.options);
    const spawnProcess = this.options.spawnProcess ?? defaultDesktopDevShellSpawn;
    for (const processPlan of plan.processes) {
      const child = spawnProcess(processPlan.command, processPlan.args, {
        cwd: processPlan.cwd,
        env: mergeDesktopDevShellEnv(process.env, processPlan.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.children.push(child);
    }
    this.plan = plan;
    return { plan, processes: plan.processes };
  }

  async shutdown(): Promise<void> {
    for (const child of [...this.children].reverse()) {
      if (!child.killed) child.kill('SIGTERM');
    }
    this.children = [];
    this.plan = undefined;
  }
}

function defaultDesktopDevShellSpawn(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
): DesktopDevShellChild {
  return spawn(command, args, options);
}

type DesktopDevShellConfig = {
  source: string | null;
  textApiKey?: string;
  textProvider?: string;
  textBaseUrl?: string;
  textModel?: string;
  visionApiKey?: string;
  visionProvider?: string;
  visionBaseUrl?: string;
  visionModel?: string;
  browserHostNativeAdapterUrl?: string;
};

function readDesktopDevShellConfig(path: string): DesktopDevShellConfig {
  if (!existsSync(path)) return { source: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) return { source: path };
    const llm = recordField(parsed, 'llm');
    const textLLM = recordField(parsed, 'textLLM');
    const textLLMEnv = recordField(textLLM, 'env');
    const visionLLM = recordField(parsed, 'visionLLM');
    const visionLLMEnv = recordField(visionLLM, 'env');
    const visionSense = recordField(parsed, 'visionSense');
    const visionSenseEnv = recordField(visionSense, 'env');
    const desktop = recordField(parsed, 'desktop');
    const desktopBrowserHost = recordField(desktop, 'browserHost');
    const browserHost = recordField(parsed, 'browserHost');
    return {
      source: path,
      textApiKey: stringValue(textLLMEnv.SCIFORGE_TEXT_API_KEY)
        ?? stringValue(textLLM.apiKey)
        ?? stringValue(llm.apiKey)
        ?? stringValue(parsed.apiKey),
      textProvider: stringValue(textLLMEnv.SCIFORGE_TEXT_PROVIDER)
        ?? stringValue(textLLM.provider)
        ?? stringValue(llm.provider)
        ?? stringValue(parsed.provider),
      textBaseUrl: stringValue(textLLMEnv.SCIFORGE_TEXT_BASE_URL)
        ?? stringValue(textLLMEnv.SCIFORGE_MODEL_BASE_URL)
        ?? stringValue(textLLM.baseUrl)
        ?? stringValue(textLLM.upstreamBaseUrl)
        ?? stringValue(textLLM.modelBaseUrl)
        ?? stringValue(llm.baseUrl)
        ?? stringValue(llm.upstreamBaseUrl)
        ?? stringValue(llm.modelBaseUrl)
        ?? stringValue(parsed.modelBaseUrl),
      textModel: stringValue(textLLMEnv.SCIFORGE_TEXT_MODEL)
        ?? stringValue(textLLM.model)
        ?? stringValue(textLLM.modelName)
        ?? stringValue(textLLM.defaultModel)
        ?? stringValue(llm.model)
        ?? stringValue(llm.modelName)
        ?? stringValue(llm.defaultModel)
        ?? stringValue(parsed.modelName)
        ?? stringValue(parsed.model),
      visionApiKey: stringValue(visionLLM.apiKey)
        ?? stringValue(visionLLMEnv.SCIFORGE_VISION_API_KEY)
        ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_API_KEY)
        ?? stringValue(visionSense.apiKey)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_API_KEY)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_API_KEY),
      visionProvider: stringValue(visionLLMEnv.SCIFORGE_VISION_PROVIDER)
        ?? stringValue(visionLLM.provider)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_PROVIDER)
        ?? stringValue(visionSense.provider),
      visionBaseUrl: stringValue(visionLLMEnv.SCIFORGE_VISION_BASE_URL)
        ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_BASE_URL)
        ?? stringValue(visionLLM.baseUrl)
        ?? stringValue(visionLLM.upstreamBaseUrl)
        ?? stringValue(visionLLM.modelBaseUrl)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_BASE_URL)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_BASE_URL)
        ?? stringValue(visionSense.vlmBaseUrl)
        ?? stringValue(visionSense.baseUrl)
        ?? stringValue(visionSense.modelBaseUrl),
      visionModel: stringValue(visionLLMEnv.SCIFORGE_VISION_MODEL)
        ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_MODEL)
        ?? stringValue(visionLLM.model)
        ?? stringValue(visionLLM.modelName)
        ?? stringValue(visionLLM.defaultModel)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_MODEL)
        ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_MODEL)
        ?? stringValue(visionSense.vlmModel)
        ?? stringValue(visionSense.model)
        ?? stringValue(visionSense.modelName),
      browserHostNativeAdapterUrl: stringValue(desktop.browserHostNativeAdapterUrl)
        ?? stringValue(desktop.nativeAdapterUrl)
        ?? stringValue(desktopBrowserHost.nativeAdapterUrl)
        ?? stringValue(browserHost.nativeAdapterUrl)
        ?? stringValue(parsed.browserHostNativeAdapterUrl),
    };
  } catch {
    return { source: path };
  }
}

function firstSanitizedLoopbackHttpUrl(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const sanitized = sanitizeLoopbackHttpUrl(value);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function loopbackHttpUrlFromPort(value: string | undefined): string | undefined {
  const port = stringValue(value);
  if (!port || !/^\d+$/.test(port)) return undefined;
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) return undefined;
  return `http://127.0.0.1:${parsed}`;
}

function sanitizeLoopbackHttpUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1') return undefined;
    const normalizedHost = hostname === 'localhost' ? '127.0.0.1' : hostname;
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${normalizedHost}${port}`;
  } catch {
    return undefined;
  }
}

function portFromUrl(value: string): string {
  try {
    return new URL(value).port;
  } catch {
    return '';
  }
}

function openAiBaseUrl(value: string): string {
  return `${value.replace(/\/+$/, '')}/v1`;
}

function compactEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}

function withUnsetEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  return {
    ...env,
    ...Object.fromEntries(keys.map((key) => [key, undefined])),
  };
}

function mergeDesktopDevShellEnv(base: NodeJS.ProcessEnv, overlay: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base, ...overlay };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) delete merged[key];
  }
  stripLegacyRuntimeDirectEnv(merged);
  return merged;
}

function stripLegacyRuntimeDirectEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key === 'SCIFORGE_RUNTIME_BASE_URL' || key.startsWith('SCIFORGE_PROXY_')) delete env[key];
  }
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key];
  return isRecord(field) ? field : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isDirectEntrypoint(): boolean {
  return process.argv.some((arg) => arg.endsWith('/tools/desktop-dev-shell.ts') || arg.endsWith('/tools/desktop-dev-shell.js'));
}

if (isDirectEntrypoint()) {
  const controller = new DesktopDevShellController();
  void controller.start().then((started) => {
    console.error(`[sciforge-desktop-dev] started ${started.processes.map((process) => process.id).join(', ')}`);
  });
  process.once('SIGINT', () => void controller.shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void controller.shutdown().finally(() => process.exit(0)));
}
