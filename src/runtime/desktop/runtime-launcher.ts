import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import {
  ensureRuntimeHome,
  RUNTIME_MODEL,
  RUNTIME_PROFILE,
} from '../../../packages/backend/src/runtime-home.js';
import { buildDesktopAppDataLayout, type DesktopAppDataLayout } from './app-data-layout.js';

export type RuntimeLauncherPortBinding = {
  name: 'control' | 'ui' | 'workspace-writer' | 'provider-proxy' | 'runtime-codex';
  requested?: number;
  actual: number;
  url: string;
  conflict: boolean;
};

export type RuntimeLauncherAuditEvent = {
  schemaVersion: 'sciforge.desktop.launcher-audit.v1';
  timestamp: string;
  serviceId: string;
  stream: 'stdout' | 'stderr' | 'lifecycle';
  message: string;
};

export type ManagedRuntimeServiceSpec = {
  id: string;
  role: 'workspace-writer' | 'provider-proxy' | 'runtime-codex' | 'custom';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ManagedRuntimeServiceStatus = {
  id: string;
  role: ManagedRuntimeServiceSpec['role'];
  state: 'starting' | 'running' | 'exited' | 'failed' | 'stopped';
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  lastError?: string;
  stdoutAuditRef: string;
  stderrAuditRef: string;
};

export type RuntimeLauncherOptions = {
  appName?: string;
  appDataRoot?: string;
  workspacePath: string;
  workspaceStateDir?: string;
  logDir?: string;
  requestedControlPort?: number;
  requestedUiPort?: number;
  requestedWorkspacePort?: number;
  requestedProviderProxyPort?: number;
  requestedRuntimeCodexPort?: number;
  services?: ManagedRuntimeServiceSpec[];
  spawnProcess?: SpawnManagedProcess;
  now?: () => Date;
};

export type RuntimeLauncherStartResult = {
  controlUrl: string;
  ports: RuntimeLauncherPortBinding[];
  appData: DesktopAppDataLayout;
  auditLogPath: string;
};

type ManagedChildProcess = {
  pid?: number;
  stdout?: Readable;
  stderr?: Readable;
  killed?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): ManagedChildProcess;
  once(event: 'error', listener: (error: Error) => void): ManagedChildProcess;
  on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): ManagedChildProcess;
  on(event: 'error', listener: (error: Error) => void): ManagedChildProcess;
};

export type SpawnManagedProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => ManagedChildProcess;

export class ProductionRuntimeLauncher {
  private server?: Server;
  private controlPort?: RuntimeLauncherPortBinding;
  private readonly sidecarPorts = new Map<RuntimeLauncherPortBinding['name'], RuntimeLauncherPortBinding>();
  private readonly statuses = new Map<string, ManagedRuntimeServiceStatus>();
  private readonly children = new Map<string, ManagedChildProcess>();
  private shuttingDown = false;
  private auditLogPath = '';
  private appData?: DesktopAppDataLayout;
  private localRuntimeEnv: Record<string, string> = {};

  constructor(private readonly options: RuntimeLauncherOptions) {}

  async start(): Promise<RuntimeLauncherStartResult> {
    if (this.server) throw new Error('Production runtime launcher is already started.');
    const appData = buildDesktopAppDataLayout({
      appName: this.options.appName,
      appDataRoot: this.options.appDataRoot,
      workspacePath: this.options.workspacePath,
      workspaceStateDir: this.options.workspaceStateDir,
    });
    this.appData = this.options.logDir ? { ...appData, logDir: resolve(this.options.logDir) } : appData;
    await createLayoutDirs(this.appData);
    this.auditLogPath = join(this.appData.logDir, 'runtime-launcher-audit.ndjson');

    const control = await this.bindControlServer(this.options.requestedControlPort);
    this.controlPort = control;
    await this.resolveSidecarPorts();
    await this.prepareDesktopLocalConfig();
    await this.prepareRuntimeCodexHome();
    for (const service of this.options.services ?? []) {
      this.startService(service);
    }

    return {
      controlUrl: control.url,
      ports: this.portBindings(),
      appData: this.appData,
      auditLogPath: this.auditLogPath,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const [id, child] of this.children) {
      const status = this.statuses.get(id);
      if (status && status.state !== 'exited' && status.state !== 'failed') status.state = 'stopped';
      if (!child.killed) child.kill('SIGTERM');
      await this.audit(id, 'lifecycle', 'shutdown requested');
    }
    const server = this.server;
    this.server = undefined;
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  health() {
    const statuses = [...this.statuses.values()];
    const ok = statuses.every((status) => status.state === 'running' || status.state === 'stopped');
    return {
      ok,
      ready: this.ready(),
      schemaVersion: 'sciforge.desktop.launcher-health.v1',
      appData: this.appData,
      ports: this.portBindings(),
      services: statuses,
      auditLogPath: this.auditLogPath,
      productionContract: {
        rendererLoadsBuildArtifact: true,
        startsViteDevServer: false,
        rendererTransport: 'stable-ipc-or-loopback',
        rawProcessOutputSurface: 'folded-audit',
        fixedDevPortsAreContract: false,
      },
    };
  }

  ready(): boolean {
    if (!this.server?.listening) return false;
    return [...this.statuses.values()].every((status) => status.state === 'running');
  }

  private async bindControlServer(requestedPort: number | undefined): Promise<RuntimeLauncherPortBinding> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/ready') {
        writeJson(res, this.ready() ? 200 : 503, { ok: this.ready(), ready: this.ready() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, this.health().ok ? 200 : 503, this.health());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') {
        writeJson(res, 202, { ok: true, shuttingDown: true });
        void this.shutdown();
        return;
      }
      writeJson(res, 404, { ok: false, error: 'not found' });
    });
    const actual = await listenOnAvailableLoopbackPort(server, requestedPort);
    this.server = server;
    return {
      name: 'control',
      requested: requestedPort,
      actual,
      url: `http://127.0.0.1:${actual}`,
      conflict: requestedPort !== undefined && requestedPort !== 0 && requestedPort !== actual,
    };
  }

  private startService(service: ManagedRuntimeServiceSpec): void {
    const status: ManagedRuntimeServiceStatus = {
      id: service.id,
      role: service.role,
      state: 'starting',
      stdoutAuditRef: `audit:desktop-launcher:${service.id}:stdout`,
      stderrAuditRef: `audit:desktop-launcher:${service.id}:stderr`,
    };
    this.statuses.set(service.id, status);

    try {
      const spawnProcess = this.options.spawnProcess ?? defaultSpawnManagedProcess;
      const child = spawnProcess(service.command, service.args ?? [], {
        cwd: resolve(service.cwd ?? process.cwd()),
        env: { ...process.env, ...this.sidecarEnv(), ...service.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.children.set(service.id, child);
      status.pid = child.pid;
      status.state = 'running';
      void this.audit(service.id, 'lifecycle', `started ${service.command} ${(service.args ?? []).join(' ')}`.trim());
      this.attachAudit(service.id, 'stdout', child.stdout);
      this.attachAudit(service.id, 'stderr', child.stderr);
      child.once('error', (error) => {
        status.state = 'failed';
        status.lastError = error.message;
        void this.audit(service.id, 'lifecycle', `spawn error: ${error.message}`);
      });
      child.once('exit', (code, signal) => {
        if (this.shuttingDown) {
          status.state = 'stopped';
        } else {
          status.state = code === 0 ? 'exited' : 'failed';
        }
        status.exitCode = code;
        status.signal = signal;
        void this.audit(service.id, 'lifecycle', `exited with ${signal ?? `code ${code}`}`);
      });
    } catch (error) {
      status.state = 'failed';
      status.lastError = error instanceof Error ? error.message : String(error);
      void this.audit(service.id, 'lifecycle', `spawn threw: ${status.lastError}`);
    }
  }

  private attachAudit(serviceId: string, stream: 'stdout' | 'stderr', readable: Readable | undefined): void {
    if (!readable) return;
    readable.setEncoding('utf8');
    readable.on('data', (chunk: string) => {
      void this.audit(serviceId, stream, chunk);
    });
  }

  private async audit(serviceId: string, stream: RuntimeLauncherAuditEvent['stream'], message: string): Promise<void> {
    if (!this.auditLogPath) return;
    const event: RuntimeLauncherAuditEvent = {
      schemaVersion: 'sciforge.desktop.launcher-audit.v1',
      timestamp: (this.options.now ?? (() => new Date()))().toISOString(),
      serviceId,
      stream,
      message,
    };
    await appendFile(this.auditLogPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private portBindings(): RuntimeLauncherPortBinding[] {
    const bindings: RuntimeLauncherPortBinding[] = [];
    if (this.controlPort) bindings.push(this.controlPort);
    for (const name of ['ui', 'workspace-writer', 'provider-proxy', 'runtime-codex'] as const) {
      const binding = this.sidecarPorts.get(name);
      if (binding) bindings.push(binding);
    }
    return bindings;
  }

  private async resolveSidecarPorts(): Promise<void> {
    await Promise.all([
      this.resolveSidecarPort('ui', this.options.requestedUiPort),
      this.resolveSidecarPort('workspace-writer', this.options.requestedWorkspacePort),
      this.resolveSidecarPort('provider-proxy', this.options.requestedProviderProxyPort),
      this.resolveSidecarPort('runtime-codex', this.options.requestedRuntimeCodexPort),
    ]);
  }

  private async resolveSidecarPort(name: RuntimeLauncherPortBinding['name'], requestedPort: number | undefined): Promise<void> {
    if (requestedPort === undefined) return;
    const actual = await findAvailableLoopbackPort(requestedPort);
    this.sidecarPorts.set(name, {
      name,
      requested: requestedPort,
      actual,
      url: `http://127.0.0.1:${actual}`,
      conflict: requestedPort !== 0 && requestedPort !== actual,
    });
  }

  private sidecarEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const ui = this.sidecarPorts.get('ui');
    const workspace = this.sidecarPorts.get('workspace-writer');
    const providerProxy = this.sidecarPorts.get('provider-proxy');
    const runtimeCodex = this.sidecarPorts.get('runtime-codex');
    if (this.appData) {
      env.SCIFORGE_CONFIG_PATH = join(this.appData.configDir, 'config.local.json');
      env.SCIFORGE_STATE_DIR = this.appData.globalStateDir;
      env.SCIFORGE_LOG_DIR = this.appData.logDir;
      env.SCIFORGE_RUNTIME_ROOT = this.appData.runtimeCodexRoot;
      env.SCIFORGE_RUNTIME_CODEX_HOME = this.appData.runtimeCodexHome;
      env.SCIFORGE_RUNTIME_DEFAULT_WORKSPACE = resolve(this.options.workspacePath);
      env.SCIFORGE_WORKSPACE_PATH = resolve(this.options.workspacePath);
    }
    Object.assign(env, this.localRuntimeEnv);
    if (ui) env.SCIFORGE_UI_PORT = String(ui.actual);
    if (workspace) {
      env.SCIFORGE_WORKSPACE_PORT = String(workspace.actual);
      env.SCIFORGE_WORKSPACE_WRITER_URL = workspace.url;
    }
    if (providerProxy) {
      env.SCIFORGE_PROXY_PORT = String(providerProxy.actual);
      env.SCIFORGE_PROXY_BASE_URL = providerProxy.url;
    }
    if (runtimeCodex) {
      env.SCIFORGE_RUNTIME_CODEX_PORT = String(runtimeCodex.actual);
      env.SCIFORGE_RUNTIME_CODEX_URL = runtimeCodex.url;
    }
    return env;
  }

  private async prepareRuntimeCodexHome(): Promise<void> {
    if (!this.appData) return;
    const providerProxy = this.sidecarPorts.get('provider-proxy');
    await ensureRuntimeHome({
      proxyBaseUrl: providerProxy ? `${providerProxy.url}/v1` : undefined,
      overwrite: true,
      paths: {
        runtimeRoot: this.appData.runtimeCodexRoot,
        codexHome: this.appData.runtimeCodexHome,
        env: this.sidecarEnv(),
      },
    });
  }

  private async prepareDesktopLocalConfig(): Promise<void> {
    if (!this.appData) return;
    const source = await readLocalRuntimeConfig(process.env.SCIFORGE_CONFIG_PATH)
      ?? await readLocalRuntimeConfig(resolve(process.cwd(), 'config.local.json'));
    this.localRuntimeEnv = source ? localRuntimeEnvFromConfig(source, process.env) : {};
    if (!source) return;
    const nonSecret = nonSecretProxyConfigFromLocalRuntimeConfig(source);
    if (!nonSecret) return;
    const target = join(this.appData.configDir, 'config.local.json');
    await writeFile(target, `${JSON.stringify({ codexProxy: nonSecret }, null, 2)}\n`, 'utf8');
  }
}

const defaultSpawnManagedProcess: SpawnManagedProcess = (command, args, options) => spawn(command, args, options) as ManagedChildProcess;

export async function findAvailableLoopbackPort(preferredPort: number | undefined): Promise<number> {
  const server = createServer();
  try {
    return await listenOnAvailableLoopbackPort(server, preferredPort);
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listenOnAvailableLoopbackPort(server: Server, preferredPort: number | undefined): Promise<number> {
  if (preferredPort === undefined || preferredPort === 0) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return addressPort(server);
  }
  for (let port = preferredPort; port < preferredPort + 50; port += 1) {
    if (!await isListening(port)) {
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      return addressPort(server);
    }
  }
  throw new Error(`No available loopback port found starting at ${preferredPort}.`);
}

function addressPort(server: Server): number {
  const address = server.address() as AddressInfo | string | null;
  if (!address || typeof address === 'string') throw new Error('Loopback server did not expose a TCP address.');
  return address.port;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolveListening) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolveListening(true);
    });
    socket.once('error', () => resolveListening(false));
  });
}

async function createLayoutDirs(layout: DesktopAppDataLayout): Promise<void> {
  await Promise.all([
    mkdir(layout.configDir, { recursive: true }),
    mkdir(layout.runtimeCodexHome, { recursive: true }),
    mkdir(layout.logDir, { recursive: true }),
    mkdir(layout.cacheDir, { recursive: true }),
    mkdir(layout.globalStateDir, { recursive: true }),
    mkdir(layout.userWorkspaceStateDir, { recursive: true }),
  ]);
}

function writeJson(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

type NonSecretProxyConfig = {
  upstreamBaseUrl?: string;
  baseUrl?: string;
  defaultModel?: string;
  model?: string;
};

type LocalRuntimeConfig = NonSecretProxyConfig & {
  apiKey?: string;
  visionBaseUrl?: string;
  visionModel?: string;
};

function localRuntimeEnvFromConfig(config: LocalRuntimeConfig, env: NodeJS.ProcessEnv): Record<string, string> {
  const output: Record<string, string> = {};
  const upstreamBaseUrl = config.upstreamBaseUrl ?? config.baseUrl;
  const visionBaseUrl = config.visionBaseUrl ?? upstreamBaseUrl;
  const defaultModel = config.defaultModel ?? config.model;
  const visionModel = config.visionModel ?? defaultModel;
  const apiKey = env.SCIFORGE_RUNTIME_API_KEY ?? config.apiKey;
  if (!env.SCIFORGE_RUNTIME_API_KEY && config.apiKey) output.SCIFORGE_RUNTIME_API_KEY = config.apiKey;
  if (!env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS) output.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS = RUNTIME_MODEL;
  if (!env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE) output.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE = RUNTIME_PROFILE;
  if (!env.SCIFORGE_RUNTIME_MODEL) output.SCIFORGE_RUNTIME_MODEL = RUNTIME_MODEL;
  if (!env.SCIFORGE_PROXY_UPSTREAM_BASE_URL && upstreamBaseUrl) output.SCIFORGE_PROXY_UPSTREAM_BASE_URL = upstreamBaseUrl;
  if (!env.SCIFORGE_TEXT_BASE_URL && upstreamBaseUrl) output.SCIFORGE_TEXT_BASE_URL = upstreamBaseUrl;
  if (!env.SCIFORGE_VISION_BASE_URL && visionBaseUrl) output.SCIFORGE_VISION_BASE_URL = visionBaseUrl;
  if (!env.SCIFORGE_TEXT_MODEL && defaultModel) output.SCIFORGE_TEXT_MODEL = defaultModel;
  if (!env.SCIFORGE_VISION_MODEL && visionModel) output.SCIFORGE_VISION_MODEL = visionModel;
  if (!env.SCIFORGE_TEXT_API_KEY && apiKey) output.SCIFORGE_TEXT_API_KEY = apiKey;
  if (!env.SCIFORGE_VISION_API_KEY && apiKey) output.SCIFORGE_VISION_API_KEY = apiKey;
  if (!env.SCIFORGE_PROXY_DEFAULT_MODEL && defaultModel) output.SCIFORGE_PROXY_DEFAULT_MODEL = defaultModel;
  return output;
}

function nonSecretProxyConfigFromLocalRuntimeConfig(config: LocalRuntimeConfig): NonSecretProxyConfig | undefined {
  const upstreamBaseUrl = config.upstreamBaseUrl ?? config.baseUrl;
  const defaultModel = config.defaultModel ?? config.model;
  if (!upstreamBaseUrl && !defaultModel) return undefined;
  return {
    ...(upstreamBaseUrl ? { upstreamBaseUrl } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  };
}

async function readLocalRuntimeConfig(path: string | undefined): Promise<LocalRuntimeConfig | undefined> {
  if (!path?.trim()) return undefined;
  const configPath = resolve(path);
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) return undefined;
    const codexProxy = isRecord(parsed.codexProxy)
      ? parsed.codexProxy
      : isRecord(parsed.runtimeCodexProxy)
        ? parsed.runtimeCodexProxy
        : {};
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const textLLM = isRecord(parsed.textLLM) ? parsed.textLLM : {};
    const textLLMEnv = isRecord(textLLM.env) ? textLLM.env : {};
    const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
    const upstreamBaseUrl = stringValue(textLLMEnv.SCIFORGE_PROXY_UPSTREAM_BASE_URL)
      ?? stringValue(textLLMEnv.SCIFORGE_MODEL_BASE_URL)
      ?? stringValue(textLLM.baseUrl)
      ?? stringValue(textLLM.modelBaseUrl)
      ?? stringValue(llm.baseUrl)
      ?? stringValue(llm.upstreamBaseUrl)
      ?? stringValue(llm.modelBaseUrl)
      ?? stringValue(codexProxy.upstreamBaseUrl)
      ?? stringValue(codexProxy.baseUrl)
      ?? stringValue(parsed.modelBaseUrl);
    const defaultModel = stringValue(textLLMEnv.SCIFORGE_RUNTIME_MODEL)
      ?? stringValue(textLLMEnv.SCIFORGE_PROXY_DEFAULT_MODEL)
      ?? stringValue(textLLM.model)
      ?? stringValue(textLLM.modelName)
      ?? stringValue(textLLM.defaultModel)
      ?? stringValue(llm.model)
      ?? stringValue(llm.modelName)
      ?? stringValue(llm.defaultModel)
      ?? stringValue(codexProxy.defaultModel)
      ?? stringValue(codexProxy.model)
      ?? stringValue(parsed.modelName)
      ?? stringValue(parsed.model);
    const apiKey = stringValue(textLLMEnv.SCIFORGE_RUNTIME_API_KEY)
      ?? stringValue(textLLM.apiKey)
      ?? stringValue(llm.apiKey)
      ?? stringValue(codexProxy.apiKey)
      ?? stringValue(parsed.apiKey);
    const visionBaseUrl = stringValue(visionSense.vlmBaseUrl)
      ?? stringValue(visionSense.baseUrl)
      ?? stringValue(visionSense.modelBaseUrl);
    const visionModel = stringValue(visionSense.vlmModel)
      ?? stringValue(visionSense.model)
      ?? stringValue(visionSense.modelName);
    if (!upstreamBaseUrl && !defaultModel && !apiKey && !visionBaseUrl && !visionModel) return undefined;
    return {
      ...(upstreamBaseUrl ? { upstreamBaseUrl } : {}),
      ...(defaultModel ? { defaultModel } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(visionBaseUrl ? { visionBaseUrl } : {}),
      ...(visionModel ? { visionModel } : {}),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
