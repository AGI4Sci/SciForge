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
  name: 'control' | 'ui' | 'workspace-writer' | 'model-router' | 'runtime-codex';
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
  role: 'workspace-writer' | 'model-router' | 'runtime-codex' | 'custom';
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
  requestedModelRouterPort?: number;
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
  private readonly childExitTasks = new Map<string, Promise<void>>();
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
    const exitTasks: Promise<void>[] = [];
    for (const [id, child] of this.children) {
      const status = this.statuses.get(id);
      if (status && status.state !== 'exited' && status.state !== 'failed') status.state = 'stopped';
      if (!child.killed) child.kill('SIGTERM');
      const exitTask = this.childExitTasks.get(id);
      if (exitTask) exitTasks.push(exitTask);
      await this.audit(id, 'lifecycle', 'shutdown requested');
    }
    await Promise.all(exitTasks.map((task) => withTimeout(task, 5_000)));
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
        env: this.serviceEnv(service),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.children.set(service.id, child);
      status.pid = child.pid;
      status.state = 'running';
      this.childExitTasks.set(service.id, managedChildExitTask(child));
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
        this.childExitTasks.delete(service.id);
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
    for (const name of ['ui', 'workspace-writer', 'model-router', 'runtime-codex'] as const) {
      const binding = this.sidecarPorts.get(name);
      if (binding) bindings.push(binding);
    }
    return bindings;
  }

  private async resolveSidecarPorts(): Promise<void> {
    await Promise.all([
      this.resolveSidecarPort('ui', this.options.requestedUiPort),
      this.resolveSidecarPort('workspace-writer', this.options.requestedWorkspacePort),
      this.resolveSidecarPort('model-router', this.options.requestedModelRouterPort),
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

  private sidecarEnv(service?: ManagedRuntimeServiceSpec): Record<string, string> {
    const env: Record<string, string> = {};
    const ui = this.sidecarPorts.get('ui');
    const workspace = this.sidecarPorts.get('workspace-writer');
    const modelRouter = this.sidecarPorts.get('model-router');
    const runtimeCodex = this.sidecarPorts.get('runtime-codex');
    if (this.appData) {
      env.SCIFORGE_DESKTOP_SIDECAR = '1';
      env.SCIFORGE_DESKTOP_USER_DATA_DIR = this.appData.appDataRoot;
      env.SCIFORGE_CONFIG_PATH = join(this.appData.configDir, 'config.local.json');
      env.SCIFORGE_STATE_DIR = this.appData.globalStateDir;
      env.SCIFORGE_LOG_DIR = this.appData.logDir;
      env.SCIFORGE_RUNTIME_ROOT = this.appData.runtimeCodexRoot;
      env.SCIFORGE_RUNTIME_CODEX_HOME = this.appData.runtimeCodexHome;
      env.SCIFORGE_RUNTIME_DEFAULT_WORKSPACE = resolve(this.options.workspacePath);
      env.SCIFORGE_WORKSPACE_PATH = resolve(this.options.workspacePath);
    }
    const runtimeRouterApiKey = runtimeRouterApiKeyFromEnv(process.env);
    if (!process.env.SCIFORGE_RUNTIME_API_KEY) env.SCIFORGE_RUNTIME_API_KEY = runtimeRouterApiKey;
    if (!process.env.SCIFORGE_MODEL_ROUTER_API_KEY) env.SCIFORGE_MODEL_ROUTER_API_KEY = runtimeRouterApiKey;
    Object.assign(env, this.localRuntimeEnvForService(service));
    if (ui) env.SCIFORGE_UI_PORT = String(ui.actual);
    if (workspace) {
      env.SCIFORGE_WORKSPACE_PORT = String(workspace.actual);
      env.SCIFORGE_WORKSPACE_WRITER_URL = workspace.url;
    }
    if (modelRouter) {
      env.SCIFORGE_MODEL_ROUTER_HOST = '127.0.0.1';
      env.SCIFORGE_MODEL_ROUTER_PORT = String(modelRouter.actual);
      env.SCIFORGE_MODEL_ROUTER_BASE_URL = `${modelRouter.url}/v1`;
    }
    if (runtimeCodex) {
      env.SCIFORGE_RUNTIME_CODEX_PORT = String(runtimeCodex.actual);
      env.SCIFORGE_RUNTIME_CODEX_URL = runtimeCodex.url;
    }
    return env;
  }

  private localRuntimeEnvForService(service: ManagedRuntimeServiceSpec | undefined): Record<string, string> {
    if (service?.role === 'model-router') return this.localRuntimeEnv;
    const env = { ...this.localRuntimeEnv };
    for (const key of MODEL_ROUTER_MEMBER_MODEL_ENV_KEYS) delete env[key];
    return env;
  }

  private serviceEnv(service: ManagedRuntimeServiceSpec): NodeJS.ProcessEnv {
    const env = { ...process.env, ...this.sidecarEnv(service), ...service.env };
    stripLegacyDirectProviderEnv(env);
    if (service.role !== 'model-router') {
      for (const key of MODEL_ROUTER_MEMBER_MODEL_ENV_KEYS) delete env[key];
    }
    return env;
  }

  private async prepareRuntimeCodexHome(): Promise<void> {
    if (!this.appData) return;
    const modelRouter = this.sidecarPorts.get('model-router');
    await ensureRuntimeHome({
      proxyBaseUrl: modelRouter ? `${modelRouter.url}/v1` : undefined,
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
    const nonSecretComputerUse = nonSecretComputerUseConfigFromLocalRuntimeConfig(source);
    const target = join(this.appData.configDir, 'config.local.json');
    await writeFile(target, `${JSON.stringify({
      ...(nonSecretComputerUse ? { visionSense: nonSecretComputerUse } : {}),
    }, null, 2)}\n`, 'utf8');
  }
}

const defaultSpawnManagedProcess: SpawnManagedProcess = (command, args, options) => spawn(command, args, options) as ManagedChildProcess;

function managedChildExitTask(child: ManagedChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', done);
    child.once('close', done);
    child.once('error', done);
  });
}

async function withTimeout(task: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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

type LocalRuntimeConfig = {
  provider?: string;
  upstreamBaseUrl?: string;
  baseUrl?: string;
  defaultModel?: string;
  model?: string;
  apiKey?: string;
  visionProvider?: string;
  visionApiKey?: string;
  textApiKeyEnv?: string;
  visionApiKeyEnv?: string;
  visionBaseUrl?: string;
  visionModel?: string;
  inputAdapter?: string;
  independentInputAdapterProvider?: string;
};

function localRuntimeEnvFromConfig(config: LocalRuntimeConfig, env: NodeJS.ProcessEnv): Record<string, string> {
  const output: Record<string, string> = {};
  const upstreamBaseUrl = config.upstreamBaseUrl ?? config.baseUrl;
  const defaultModel = config.defaultModel ?? config.model;
  const visionModel = config.visionModel;
  const visionBaseUrl = visionModel ? config.visionBaseUrl ?? upstreamBaseUrl : undefined;
  const apiKey = config.apiKey;
  const visionApiKey = visionModel ? config.visionApiKey ?? apiKey : undefined;
  const inputAdapter = nonSecretComputerUseInputAdapter(config.inputAdapter);
  const independentInputAdapterProvider = nonSecretComputerUseInputAdapterProvider(config.independentInputAdapterProvider);
  if (!env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS) output.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS = RUNTIME_MODEL;
  if (!env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE) output.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE = RUNTIME_PROFILE;
  if (!env.SCIFORGE_RUNTIME_MODEL) output.SCIFORGE_RUNTIME_MODEL = RUNTIME_MODEL;
  if (!env.SCIFORGE_TEXT_PROVIDER && config.provider) output.SCIFORGE_TEXT_PROVIDER = config.provider;
  if (!env.SCIFORGE_VISION_PROVIDER && visionModel && config.visionProvider) output.SCIFORGE_VISION_PROVIDER = config.visionProvider;
  if (!env.SCIFORGE_TEXT_BASE_URL && upstreamBaseUrl) output.SCIFORGE_TEXT_BASE_URL = upstreamBaseUrl;
  if (!env.SCIFORGE_VISION_BASE_URL && visionBaseUrl) output.SCIFORGE_VISION_BASE_URL = visionBaseUrl;
  if (!env.SCIFORGE_TEXT_MODEL && defaultModel) output.SCIFORGE_TEXT_MODEL = defaultModel;
  if (!env.SCIFORGE_VISION_MODEL && visionModel) output.SCIFORGE_VISION_MODEL = visionModel;
  if (!env.SCIFORGE_TEXT_API_KEY && apiKey) output.SCIFORGE_TEXT_API_KEY = apiKey;
  if (!env.SCIFORGE_TEXT_API_KEY_ENV && config.textApiKeyEnv) output.SCIFORGE_TEXT_API_KEY_ENV = config.textApiKeyEnv;
  if (!env.SCIFORGE_VISION_API_KEY && visionApiKey) output.SCIFORGE_VISION_API_KEY = visionApiKey;
  if (!env.SCIFORGE_VISION_API_KEY_ENV && config.visionApiKeyEnv) output.SCIFORGE_VISION_API_KEY_ENV = config.visionApiKeyEnv;
  if (!env.SCIFORGE_VISION_INPUT_ADAPTER && inputAdapter) output.SCIFORGE_VISION_INPUT_ADAPTER = inputAdapter;
  if (!env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER && independentInputAdapterProvider) {
    output.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER = independentInputAdapterProvider;
  }
  return output;
}

const LOCAL_MODEL_ROUTER_API_KEY = 'sciforge-local-model-router';

const MODEL_ROUTER_MEMBER_MODEL_ENV_KEYS = new Set([
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
]);

const LEGACY_DIRECT_PROVIDER_ENV_KEYS = new Set([
  'SCIFORGE_RUNTIME_BASE_URL',
]);

function stripLegacyDirectProviderEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith('SCIFORGE_PROXY_') || LEGACY_DIRECT_PROVIDER_ENV_KEYS.has(key)) delete env[key];
  }
}

function runtimeRouterApiKeyFromEnv(env: NodeJS.ProcessEnv): string {
  return stringValue(env.SCIFORGE_MODEL_ROUTER_API_KEY)
    ?? stringValue(env.SCIFORGE_RUNTIME_API_KEY)
    ?? LOCAL_MODEL_ROUTER_API_KEY;
}

function nonSecretComputerUseConfigFromLocalRuntimeConfig(config: LocalRuntimeConfig): {
  inputAdapter?: string;
  independentInputAdapterProvider?: string;
} | undefined {
  const inputAdapter = nonSecretComputerUseInputAdapter(config.inputAdapter);
  const independentInputAdapterProvider = nonSecretComputerUseInputAdapterProvider(config.independentInputAdapterProvider);
  if (!inputAdapter && !independentInputAdapterProvider) return undefined;
  return {
    ...(inputAdapter ? { inputAdapter } : {}),
    ...(independentInputAdapterProvider ? { independentInputAdapterProvider } : {}),
  };
}

function nonSecretComputerUseInputAdapter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;
  if (!['remote-desktop', 'remote-desktop-session', 'virtual-hid', 'virtual-hid-device', 'window-action-session'].includes(normalized)) {
    return undefined;
  }
  if (/(?:shared|system|cg-?event|mouse|keyboard|secret|token|password|api-?key|url)/i.test(normalized)) return undefined;
  return normalized;
}

function nonSecretComputerUseInputAdapterProvider(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 96) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) return undefined;
  if (/(?:shared|system|cg-?event|secret|token|password|api-?key|bearer|https?|url)/i.test(normalized)) return undefined;
  return normalized;
}

async function readLocalRuntimeConfig(path: string | undefined): Promise<LocalRuntimeConfig | undefined> {
  if (!path?.trim()) return undefined;
  const configPath = resolve(path);
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) return undefined;
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const llmEnv = isRecord(llm.env) ? llm.env : {};
    const textLLM = isRecord(parsed.textLLM) ? parsed.textLLM : {};
    const textLLMEnv = isRecord(textLLM.env) ? textLLM.env : {};
    const visionLLM = isRecord(parsed.visionLLM) ? parsed.visionLLM : {};
    const visionLLMEnv = isRecord(visionLLM.env) ? visionLLM.env : {};
    const visionSense = isRecord(parsed.visionSense) ? parsed.visionSense : {};
    const visionSenseEnv = isRecord(visionSense.env) ? visionSense.env : {};
    const computerUse = isRecord(parsed.computerUse) ? parsed.computerUse : {};
    const provider = stringValue(textLLMEnv.SCIFORGE_TEXT_PROVIDER)
      ?? stringValue(textLLM.provider)
      ?? stringValue(llmEnv.SCIFORGE_TEXT_PROVIDER)
      ?? stringValue(llm.provider)
      ?? stringValue(parsed.provider);
    const upstreamBaseUrl = stringValue(textLLMEnv.SCIFORGE_TEXT_BASE_URL)
      ?? stringValue(textLLMEnv.SCIFORGE_MODEL_BASE_URL)
      ?? stringValue(textLLM.baseUrl)
      ?? stringValue(textLLM.upstreamBaseUrl)
      ?? stringValue(textLLM.modelBaseUrl)
      ?? stringValue(llmEnv.SCIFORGE_TEXT_BASE_URL)
      ?? stringValue(llmEnv.SCIFORGE_MODEL_BASE_URL)
      ?? stringValue(llm.baseUrl)
      ?? stringValue(llm.upstreamBaseUrl)
      ?? stringValue(llm.modelBaseUrl)
      ?? stringValue(parsed.modelBaseUrl);
    const defaultModel = stringValue(textLLMEnv.SCIFORGE_TEXT_MODEL)
      ?? stringValue(textLLM.model)
      ?? stringValue(textLLM.modelName)
      ?? stringValue(textLLM.defaultModel)
      ?? stringValue(llmEnv.SCIFORGE_TEXT_MODEL)
      ?? stringValue(llm.model)
      ?? stringValue(llm.modelName)
      ?? stringValue(llm.defaultModel)
      ?? stringValue(parsed.modelName)
      ?? stringValue(parsed.model);
    const apiKey = stringValue(textLLMEnv.SCIFORGE_TEXT_API_KEY)
      ?? stringValue(textLLM.apiKey)
      ?? stringValue(llmEnv.SCIFORGE_TEXT_API_KEY)
      ?? stringValue(llm.apiKey)
      ?? stringValue(parsed.apiKey);
    const textApiKeyEnv = stringValue(textLLMEnv.SCIFORGE_TEXT_API_KEY_ENV)
      ?? stringValue(llmEnv.SCIFORGE_TEXT_API_KEY_ENV);
    const visionProvider = stringValue(visionLLMEnv.SCIFORGE_VISION_PROVIDER)
      ?? stringValue(visionLLM.provider)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_PROVIDER)
      ?? stringValue(visionSense.provider);
    const visionApiKey = stringValue(visionLLM.apiKey)
      ?? stringValue(visionLLMEnv.SCIFORGE_VISION_API_KEY)
      ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_API_KEY)
      ?? stringValue(visionSense.apiKey)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_API_KEY)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_API_KEY);
    const visionApiKeyEnv = stringValue(visionLLMEnv.SCIFORGE_VISION_API_KEY_ENV)
      ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_API_KEY_ENV)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_API_KEY_ENV)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_API_KEY_ENV);
    const visionBaseUrl = stringValue(visionLLMEnv.SCIFORGE_VISION_BASE_URL)
      ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_BASE_URL)
      ?? stringValue(visionLLM.baseUrl)
      ?? stringValue(visionLLM.upstreamBaseUrl)
      ?? stringValue(visionLLM.modelBaseUrl)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_BASE_URL)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_BASE_URL)
      ?? stringValue(visionSense.vlmBaseUrl)
      ?? stringValue(visionSense.baseUrl)
      ?? stringValue(visionSense.modelBaseUrl);
    const visionModel = stringValue(visionLLMEnv.SCIFORGE_VISION_MODEL)
      ?? stringValue(visionLLMEnv.SCIFORGE_VISION_VLM_MODEL)
      ?? stringValue(visionLLM.model)
      ?? stringValue(visionLLM.modelName)
      ?? stringValue(visionLLM.defaultModel)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_MODEL)
      ?? stringValue(visionSenseEnv.SCIFORGE_VISION_VLM_MODEL)
      ?? stringValue(visionSense.vlmModel)
      ?? stringValue(visionSense.model)
      ?? stringValue(visionSense.modelName);
    const inputAdapter = stringValue(visionSense.inputAdapter)
      ?? stringValue(computerUse.inputAdapter);
    const independentInputAdapterProvider = stringValue(visionSense.independentInputAdapterProvider)
      ?? stringValue(visionSense.inputAdapterProvider)
      ?? stringValue(computerUse.independentInputAdapterProvider)
      ?? stringValue(computerUse.inputAdapterProvider);
    if (!provider && !upstreamBaseUrl && !defaultModel && !apiKey && !textApiKeyEnv && !visionProvider && !visionBaseUrl && !visionModel && !visionApiKeyEnv && !inputAdapter && !independentInputAdapterProvider) return undefined;
    return {
      ...(provider ? { provider } : {}),
      ...(upstreamBaseUrl ? { upstreamBaseUrl } : {}),
      ...(defaultModel ? { defaultModel } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(textApiKeyEnv ? { textApiKeyEnv } : {}),
      ...(visionProvider ? { visionProvider } : {}),
      ...(visionApiKey ? { visionApiKey } : {}),
      ...(visionApiKeyEnv ? { visionApiKeyEnv } : {}),
      ...(visionBaseUrl ? { visionBaseUrl } : {}),
      ...(visionModel ? { visionModel } : {}),
      ...(inputAdapter ? { inputAdapter } : {}),
      ...(independentInputAdapterProvider ? { independentInputAdapterProvider } : {}),
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
