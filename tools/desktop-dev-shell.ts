import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { buildDesktopNativeReadiness, type DesktopNativeReadiness } from '../src/desktop/native-readiness.js';

export type DesktopDevShellProcessId = 'vite' | 'workspace-writer' | 'provider-proxy' | 'runtime-codex' | 'electron';

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
      credentialSource: 'env' | 'config' | 'missing';
      upstreamBaseUrlConfigured: boolean;
      modelConfigured: boolean;
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
  providerProxyUrl?: string;
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
  const providerProxyUrl = sanitizeLoopbackHttpUrl(options.providerProxyUrl ?? 'http://127.0.0.1:5175') ?? 'http://127.0.0.1:5175';
  const runtimeCodexUrl = sanitizeLoopbackHttpUrl(options.runtimeCodexUrl ?? 'http://127.0.0.1:5176') ?? 'http://127.0.0.1:5176';
  const nativeAdapterUrl = sanitizeLoopbackHttpUrl(options.nativeAdapterUrl ?? env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL);
  const apiKey = stringValue(env.SCIFORGE_RUNTIME_API_KEY) ?? config.apiKey;
  const upstreamBaseUrl = stringValue(env.SCIFORGE_PROXY_UPSTREAM_BASE_URL) ?? config.upstreamBaseUrl;
  const model = stringValue(env.SCIFORGE_RUNTIME_MODEL)
    ?? stringValue(env.SCIFORGE_PROXY_DEFAULT_MODEL)
    ?? config.model;

  const sidecarEnv: NodeJS.ProcessEnv = compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    SCIFORGE_RUNTIME_DEFAULT_WORKSPACE: workspacePath,
    SCIFORGE_WORKSPACE_WRITER_URL: workspaceWriterUrl,
    SCIFORGE_PROXY_BASE_URL: providerProxyUrl,
    SCIFORGE_RUNTIME_CODEX_URL: runtimeCodexUrl,
    SCIFORGE_WORKSPACE_PORT: portFromUrl(workspaceWriterUrl),
    SCIFORGE_RUNTIME_CODEX_HOST: '127.0.0.1',
    SCIFORGE_RUNTIME_CODEX_PORT: portFromUrl(runtimeCodexUrl),
    ...(nativeAdapterUrl ? { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: nativeAdapterUrl } : {}),
    ...(apiKey ? { SCIFORGE_RUNTIME_API_KEY: apiKey } : {}),
    ...(upstreamBaseUrl ? { SCIFORGE_PROXY_UPSTREAM_BASE_URL: upstreamBaseUrl } : {}),
    ...(model ? {
      SCIFORGE_RUNTIME_MODEL: model,
      SCIFORGE_PROXY_DEFAULT_MODEL: model,
    } : {}),
  });
  const rendererEnv: NodeJS.ProcessEnv = compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: workspaceWriterUrl,
  });
  const electronEnv: NodeJS.ProcessEnv = compactEnv({
    SCIFORGE_DESKTOP_DEV: '1',
    SCIFORGE_DESKTOP_APP_ROOT: projectRoot,
    SCIFORGE_DESKTOP_RENDERER_URL: rendererUrl,
    SCIFORGE_DESKTOP_WORKSPACE_PATH: workspacePath,
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    ...(nativeAdapterUrl ? { SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL: nativeAdapterUrl } : {}),
  });

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
      env: sidecarEnv,
    },
    {
      id: 'provider-proxy',
      command: 'npm',
      args: ['run', 'backend:codex-proxy', '--', '--quiet', '--host', '127.0.0.1', '--port', portFromUrl(providerProxyUrl)],
      cwd: projectRoot,
      env: sidecarEnv,
    },
    {
      id: 'runtime-codex',
      command: 'npm',
      args: ['run', 'backend:codex-runtime:server'],
      cwd: projectRoot,
      env: sidecarEnv,
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
        credentialSource: stringValue(env.SCIFORGE_RUNTIME_API_KEY) ? 'env' : config.apiKey ? 'config' : 'missing',
        upstreamBaseUrlConfigured: Boolean(upstreamBaseUrl),
        modelConfigured: Boolean(model),
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
        env: { ...process.env, ...processPlan.env },
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
  apiKey?: string;
  upstreamBaseUrl?: string;
  model?: string;
};

function readDesktopDevShellConfig(path: string): DesktopDevShellConfig {
  if (!existsSync(path)) return { source: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) return { source: path };
    const llm = recordField(parsed, 'llm');
    const textLLM = recordField(parsed, 'textLLM');
    const textLLMEnv = recordField(textLLM, 'env');
    const codexProxy = recordField(parsed, 'codexProxy');
    return {
      source: path,
      apiKey: stringValue(textLLMEnv.SCIFORGE_RUNTIME_API_KEY)
        ?? stringValue(textLLM.apiKey)
        ?? stringValue(llm.apiKey)
        ?? stringValue(parsed.apiKey),
      upstreamBaseUrl: stringValue(textLLMEnv.SCIFORGE_PROXY_UPSTREAM_BASE_URL)
        ?? stringValue(textLLMEnv.SCIFORGE_MODEL_BASE_URL)
        ?? stringValue(textLLM.modelBaseUrl)
        ?? stringValue(llm.baseUrl)
        ?? stringValue(llm.modelBaseUrl)
        ?? stringValue(codexProxy.upstreamBaseUrl)
        ?? stringValue(codexProxy.baseUrl)
        ?? stringValue(parsed.modelBaseUrl),
      model: stringValue(textLLMEnv.SCIFORGE_RUNTIME_MODEL)
        ?? stringValue(textLLMEnv.SCIFORGE_PROXY_DEFAULT_MODEL)
        ?? stringValue(textLLM.model)
        ?? stringValue(textLLM.modelName)
        ?? stringValue(llm.model)
        ?? stringValue(llm.modelName)
        ?? stringValue(codexProxy.defaultModel)
        ?? stringValue(codexProxy.model)
        ?? stringValue(parsed.modelName)
        ?? stringValue(parsed.model),
    };
  } catch {
    return { source: path };
  }
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

function compactEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
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
