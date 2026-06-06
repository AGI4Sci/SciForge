import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductionRuntimeLauncher,
  type ManagedRuntimeServiceSpec,
  type SpawnManagedProcess,
} from './runtime-launcher.js';
import { RUNTIME_MODEL } from '../../../packages/backend/src/runtime-home.js';

test('production launcher exposes ready and health over dynamic loopback control port', async () => {
  const root = await tempRoot();
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    requestedUiPort: 0,
    requestedWorkspacePort: 0,
    requestedProviderProxyPort: 0,
    requestedRuntimeCodexPort: 0,
  });
  const started = await launcher.start();
  try {
    assert.match(started.controlUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const ready = await fetchJson(`${started.controlUrl}/ready`);
    assert.deepEqual(ready, { ok: true, ready: true });
    const health = await fetchJson(`${started.controlUrl}/health`) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.ready, true);
    const ports = health.ports as Array<{ name: string; requested: number; actual: number; url: string; conflict: boolean }>;
    assert.deepEqual(ports.map((port) => port.name), ['control', 'ui', 'workspace-writer', 'provider-proxy', 'runtime-codex']);
    for (const port of ports) {
      assert.ok(port.actual > 0, `${port.name} actual port should be assigned`);
      assert.equal(port.url, `http://127.0.0.1:${port.actual}`);
      assert.equal(port.conflict, false, `${port.name} dynamic port should not report a conflict`);
    }
    assert.equal(ports.find((port) => port.name === 'control')?.actual, Number(new URL(started.controlUrl).port));
  } finally {
    await launcher.shutdown();
  }
});

test('production launcher moves control API to the next free loopback port on conflict', async () => {
  const root = await tempRoot();
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => occupied.once('listening', resolve));
  const address = occupied.address();
  assert.equal(typeof address, 'object');
  const requestedControlPort = address && typeof address === 'object' ? address.port : 0;
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort,
  });

  try {
    const started = await launcher.start();
    const binding = started.ports.find((port) => port.name === 'control');
    assert.equal(binding?.requested, requestedControlPort);
    assert.equal(binding?.conflict, true);
    assert.notEqual(binding?.actual, requestedControlPort);
    assert.equal((await fetchJson(`${started.controlUrl}/ready`) as { ok: boolean }).ok, true);
  } finally {
    await launcher.shutdown();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

test('production launcher resolves sidecar port conflicts and injects actual ports into managed services', async () => {
  const root = await tempRoot();
  const occupiedWorkspace = createServer();
  const occupiedProviderProxy = createServer();
  const occupiedRuntime = createServer();
  occupiedWorkspace.listen(0, '127.0.0.1');
  occupiedProviderProxy.listen(0, '127.0.0.1');
  occupiedRuntime.listen(0, '127.0.0.1');
  await Promise.all([
    new Promise<void>((resolve) => occupiedWorkspace.once('listening', resolve)),
    new Promise<void>((resolve) => occupiedProviderProxy.once('listening', resolve)),
    new Promise<void>((resolve) => occupiedRuntime.once('listening', resolve)),
  ]);
  const workspacePort = portForServer(occupiedWorkspace);
  const providerProxyPort = portForServer(occupiedProviderProxy);
  const runtimeCodexPort = portForServer(occupiedRuntime);
  const child = new FakeChild(1203);
  const capturedEnv: NodeJS.ProcessEnv[] = [];
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    requestedUiPort: 0,
    requestedWorkspacePort: workspacePort,
    requestedProviderProxyPort: providerProxyPort,
    requestedRuntimeCodexPort: runtimeCodexPort,
    services: [service('provider-proxy'), service('runtime-codex')],
    spawnProcess: ((_command, _args, options) => {
      capturedEnv.push(options.env);
      return child;
    }) as SpawnManagedProcess,
  });

  try {
    const started = await launcher.start();
    const workspaceBinding = started.ports.find((port) => port.name === 'workspace-writer');
    const providerBinding = started.ports.find((port) => port.name === 'provider-proxy');
    const runtimeBinding = started.ports.find((port) => port.name === 'runtime-codex');
    const uiBinding = started.ports.find((port) => port.name === 'ui');

    assert.equal(workspaceBinding?.requested, workspacePort);
    assert.equal(workspaceBinding?.conflict, true);
    assert.notEqual(workspaceBinding?.actual, workspacePort);
    assert.equal(providerBinding?.requested, providerProxyPort);
    assert.equal(providerBinding?.conflict, true);
    assert.notEqual(providerBinding?.actual, providerProxyPort);
    assert.equal(runtimeBinding?.requested, runtimeCodexPort);
    assert.equal(runtimeBinding?.conflict, true);
    assert.notEqual(runtimeBinding?.actual, runtimeCodexPort);
    assert.equal(uiBinding?.requested, 0);
    assert.equal(uiBinding?.conflict, false);
    assert.match(String(capturedEnv[0]?.SCIFORGE_UI_PORT), /^\d+$/);
    assert.equal(capturedEnv[0]?.SCIFORGE_WORKSPACE_PORT, String(workspaceBinding?.actual));
    assert.equal(capturedEnv[0]?.SCIFORGE_WORKSPACE_WRITER_URL, workspaceBinding?.url);
    assert.equal(capturedEnv[0]?.SCIFORGE_PROXY_PORT, String(providerBinding?.actual));
    assert.equal(capturedEnv[0]?.SCIFORGE_PROXY_BASE_URL, providerBinding?.url);
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_CODEX_PORT, String(runtimeBinding?.actual));
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_CODEX_URL, runtimeBinding?.url);
    assert.equal(capturedEnv[0]?.SCIFORGE_DESKTOP_SIDECAR, '1');
    assert.equal(capturedEnv[0]?.SCIFORGE_DESKTOP_USER_DATA_DIR, join(root, 'app-data'));
    assert.equal(capturedEnv[0]?.SCIFORGE_CONFIG_PATH, join(root, 'app-data', 'config', 'config.local.json'));
    assert.equal(capturedEnv[0]?.SCIFORGE_STATE_DIR, join(root, 'app-data', 'state'));
    assert.equal(capturedEnv[0]?.SCIFORGE_LOG_DIR, join(root, 'app-data', 'logs'));
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_ROOT, join(root, 'app-data', 'runtime-codex'));
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_CODEX_HOME, join(root, 'app-data', 'runtime-codex', 'codex-home'));
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_DEFAULT_WORKSPACE, join(root, 'workspace'));
    assert.equal(capturedEnv[0]?.SCIFORGE_WORKSPACE_PATH, join(root, 'workspace'));

    const health = await fetchJson(`${started.controlUrl}/health`) as Record<string, unknown>;
    assert.equal((health.productionContract as Record<string, unknown>).fixedDevPortsAreContract, false);
  } finally {
    await launcher.shutdown();
    await Promise.all([
      new Promise<void>((resolve) => occupiedWorkspace.close(() => resolve())),
      new Promise<void>((resolve) => occupiedProviderProxy.close(() => resolve())),
      new Promise<void>((resolve) => occupiedRuntime.close(() => resolve())),
    ]);
  }
});

test('production launcher records child stderr to folded audit and reports failed health on child exit', async () => {
  const root = await tempRoot();
  const child = new FakeChild(1201);
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    services: [service('workspace')],
    spawnProcess: (() => child) as SpawnManagedProcess,
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });
  const started = await launcher.start();
  try {
    child.stderr.write('RAW STDERR SHOULD STAY IN AUDIT\n');
    child.exit(2, null);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const healthResponse = await fetch(`${started.controlUrl}/health`);
    assert.equal(healthResponse.status, 503);
    const healthText = await healthResponse.text();
    assert.match(healthText, /"state":"failed"/);
    assert.doesNotMatch(healthText, /RAW STDERR SHOULD STAY IN AUDIT/);

    const audit = await readFile(started.auditLogPath, 'utf8');
    assert.match(audit, /RAW STDERR SHOULD STAY IN AUDIT/);
    assert.match(audit, /"stream":"stderr"/);
    assert.match(audit, /"stream":"lifecycle"/);
  } finally {
    await launcher.shutdown();
  }
});

test('production launcher projects only non-secret proxy config into app-data config for packaged sidecars', async () => {
  const root = await tempRoot();
  const sourceConfig = join(root, 'source-config.local.json');
  await writeFile(sourceConfig, JSON.stringify({
    codexProxy: {
      upstreamBaseUrl: 'https://provider.example.test/openai-compatible',
      defaultModel: 'bailian/deepseek-v4-flash',
      apiKey: 'sk-should-not-copy',
    },
    llm: {
      apiKey: 'sk-llm-should-not-copy',
    },
  }), 'utf8');
  const previousConfigPath = process.env.SCIFORGE_CONFIG_PATH;
  process.env.SCIFORGE_CONFIG_PATH = sourceConfig;

  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
  });
  try {
    await launcher.start();
    const desktopConfigPath = join(root, 'app-data', 'config', 'config.local.json');
    const desktopConfig = await readFile(desktopConfigPath, 'utf8');
    assert.match(desktopConfig, /provider\.example\.test/);
    assert.match(desktopConfig, /bailian\/deepseek-v4-flash/);
    assert.doesNotMatch(desktopConfig, /apiKey|sk-should-not-copy|sk-llm-should-not-copy/);
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.SCIFORGE_CONFIG_PATH;
    } else {
      process.env.SCIFORGE_CONFIG_PATH = previousConfigPath;
    }
    await launcher.shutdown();
  }
});

test('production launcher maps local provider config into Model Router role env and public runtime alias', async () => {
  const root = await tempRoot();
  const sourceConfig = join(root, 'source-config.local.json');
  await writeFile(sourceConfig, JSON.stringify({
    codexProxy: {
      upstreamBaseUrl: 'https://provider.example.test/openai-compatible',
      defaultModel: 'bailian/deepseek-v4-flash',
      apiKey: 'sk-local-dev-secret',
    },
    visionSense: {
      vlmModel: 'qwen3.7-plus',
    },
  }), 'utf8');
  const envKeys = [
    'SCIFORGE_CONFIG_PATH',
    'SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE',
    'SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS',
    'SCIFORGE_PROXY_DEFAULT_MODEL',
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
    'SCIFORGE_RUNTIME_API_KEY',
    'SCIFORGE_RUNTIME_MODEL',
    'SCIFORGE_TEXT_API_KEY',
    'SCIFORGE_TEXT_BASE_URL',
    'SCIFORGE_TEXT_MODEL',
    'SCIFORGE_VISION_API_KEY',
    'SCIFORGE_VISION_BASE_URL',
    'SCIFORGE_VISION_MODEL',
  ];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.SCIFORGE_CONFIG_PATH = sourceConfig;

  const child = new FakeChild(1204);
  const capturedEnv: NodeJS.ProcessEnv[] = [];
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    requestedProviderProxyPort: 0,
    services: [service('provider-proxy')],
    spawnProcess: ((_command, _args, options) => {
      capturedEnv.push(options.env);
      return child;
    }) as SpawnManagedProcess,
  });

  try {
    const started = await launcher.start();
    const providerBinding = started.ports.find((port) => port.name === 'provider-proxy');
    assert.equal(capturedEnv[0]?.SCIFORGE_RUNTIME_MODEL, RUNTIME_MODEL);
    assert.equal(capturedEnv[0]?.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, RUNTIME_MODEL);
    assert.equal(capturedEnv[0]?.SCIFORGE_TEXT_BASE_URL, 'https://provider.example.test/openai-compatible');
    assert.equal(capturedEnv[0]?.SCIFORGE_VISION_BASE_URL, 'https://provider.example.test/openai-compatible');
    assert.equal(capturedEnv[0]?.SCIFORGE_TEXT_MODEL, 'bailian/deepseek-v4-flash');
    assert.equal(capturedEnv[0]?.SCIFORGE_VISION_MODEL, 'qwen3.7-plus');
    assert.equal(capturedEnv[0]?.SCIFORGE_TEXT_API_KEY, 'sk-local-dev-secret');
    assert.equal(capturedEnv[0]?.SCIFORGE_VISION_API_KEY, 'sk-local-dev-secret');
    assert.equal(capturedEnv[0]?.SCIFORGE_PROXY_BASE_URL, providerBinding?.url);

    const runtimeConfig = await readFile(join(root, 'app-data', 'runtime-codex', 'codex-home', 'config.toml'), 'utf8');
    assert.match(runtimeConfig, /model = "sciforge-router"/);
    assert.match(runtimeConfig, /base_url = "http:\/\/127\.0\.0\.1:\d+\/v1"/);
    assert.doesNotMatch(runtimeConfig, /bailian\/deepseek-v4-flash|provider\.example\.test|sk-local-dev-secret/);
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await launcher.shutdown();
  }
});

test('production launcher shutdown terminates managed children and closes control server', async () => {
  const root = await tempRoot();
  const child = new FakeChild(1202);
  const launcher = new ProductionRuntimeLauncher({
    workspacePath: join(root, 'workspace'),
    appDataRoot: join(root, 'app-data'),
    requestedControlPort: 0,
    services: [service('runtime-codex')],
    spawnProcess: (() => child) as SpawnManagedProcess,
  });
  const started = await launcher.start();
  await launcher.shutdown();

  assert.equal(child.killed, true);
  await assert.rejects(() => fetch(`${started.controlUrl}/ready`));
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null, 'SIGTERM');
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }
}

function service(id: string): ManagedRuntimeServiceSpec {
  return {
    id,
    role: id === 'runtime-codex' ? 'runtime-codex' : id === 'provider-proxy' ? 'provider-proxy' : 'workspace-writer',
    command: 'node',
    args: ['service.js'],
  };
}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-launcher-test-'));
  await mkdir(join(root, 'workspace'), { recursive: true });
  return root;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}

function portForServer(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return (address as AddressInfo).port;
}
