import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

type DesktopRuntimeConfig = {
  schemaVersion: 'sciforge.desktop.runtime-config.v1';
  runtimeControlUrl: string;
  workspaceWriterBaseUrl: string;
  modelBaseUrl: string;
  runtimeCodexBaseUrl: string;
  workspacePath: string;
  appDataRoot: string;
  appRoot: string;
  sidecarCwd: string;
  ports: Array<{
    name: 'control' | 'ui' | 'workspace-writer' | 'model-router' | 'runtime-codex';
    requested?: number;
    actual: number;
    url: string;
    conflict: boolean;
  }>;
};

type DesktopHealth = {
  ok: boolean;
  ready: boolean;
  schemaVersion: 'sciforge.desktop.launcher-health.v1';
  services?: Array<{
    id: string;
    role: string;
    state: string;
    lastError?: string;
    exitCode?: number | null;
    signal?: string | null;
  }>;
};

type DesktopBridgeApi = {
  getRuntimeConfig(): Promise<unknown>;
  getRuntimeHealth(): Promise<unknown>;
  requestShutdown(): Promise<unknown>;
};

const projectRoot = process.cwd();
const mainPath = resolve(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js');
const rendererPath = resolve(projectRoot, 'dist-ui', 'index.html');

if (!existsSync(mainPath) || !existsSync(rendererPath)) {
  throw new Error('Desktop lifecycle smoke requires built production artifacts. Run `npm run desktop:build` first.');
}

const scratchRoot = await mkdtemp(join(tmpdir(), 'sciforge-desktop-electron-lifecycle-'));
const userDataDir = join(scratchRoot, 'userData');
const workspaceDir = join(scratchRoot, 'workspace');
const configPath = join(scratchRoot, 'missing-config.local.json');
const dummyMemberProvider = await startDummyProvider();
const lifecycleEnv = buildRouterOnlyLifecycleEnv(dummyMemberProvider.url, {
  appRoot: projectRoot,
  userDataDir,
  workspaceDir,
  configPath,
});
let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;

try {
  electronApp = await electron.launch({
    args: [mainPath],
    env: lifecycleEnv,
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  assert.equal(page.url(), pathToFileURL(rendererPath).href);
  assert.equal(await page.evaluate(() => typeof (window as unknown as { sciforgeDesktop?: DesktopBridgeApi }).sciforgeDesktop), 'object');
  const apiKeys = await page.evaluate(() => Object.keys((window as Window & { sciforgeDesktop?: DesktopBridgeApi }).sciforgeDesktop ?? {}).sort());
  for (const requiredKey of [
    'attachBrowserHostSessionSurface',
    'captureNativeBrowserScreenshot',
    'detachBrowserHostSessionSurface',
    'getBrowserHostSessionSurfaceState',
    'getNativeBrowserState',
    'getRuntimeConfig',
    'getRuntimeHealth',
    'getRuntimeReady',
    'nativeBrowserBack',
    'nativeBrowserForward',
    'nativeBrowserReload',
    'openExternal',
    'openNativeBrowser',
    'pickDirectory',
    'requestShutdown',
    'revealPath',
  ]) {
    assert.ok(apiKeys.includes(requiredKey), `desktop bridge exposes ${requiredKey}`);
  }
  assert.equal(apiKeys.some((key) => /VirtualAppScreen/.test(key)), false);

  const config = await page.evaluate(() =>
    (window as unknown as { sciforgeDesktop: DesktopBridgeApi }).sciforgeDesktop.getRuntimeConfig(),
  ) as DesktopRuntimeConfig;
  assert.equal(config.schemaVersion, 'sciforge.desktop.runtime-config.v1');
  assert.equal(config.appDataRoot, userDataDir);
  assert.equal(config.workspacePath, workspaceDir);
  assert.equal(config.appRoot, projectRoot);
  assert.equal(config.sidecarCwd, projectRoot);
  assertDynamicLoopbackConfig(config);

  const health = await page.evaluate(() =>
    (window as unknown as { sciforgeDesktop: DesktopBridgeApi }).sciforgeDesktop.getRuntimeHealth(),
  ) as DesktopHealth;
  const sidecarEvidence = classifySidecarHealth(health);
  assert.equal(health.schemaVersion, 'sciforge.desktop.launcher-health.v1');
  assert.equal(health.ok, true);
  assert.equal(health.ready, true);
  assert.deepEqual(
    sidecarEvidence.serviceStates.map((service) => [service.id, service.state]).sort(),
    [
      ['model-router', 'running'],
      ['runtime-codex', 'running'],
      ['workspace-server', 'running'],
    ],
  );
  assert.deepEqual(sidecarEvidence.claimScope, 'diagnostic-only');

  const shutdown = await page.evaluate(() =>
    (window as unknown as { sciforgeDesktop: DesktopBridgeApi }).sciforgeDesktop.requestShutdown(),
  ) as { ok?: boolean };
  assert.deepEqual(shutdown, { ok: true });
  await electronApp.close();
  electronApp = undefined;

  console.log(`[ok] desktop electron lifecycle smoke loaded ${page.url()}; sidecarHealth=${JSON.stringify(sidecarEvidence)}`);
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  await dummyMemberProvider.close();
  await rm(scratchRoot, { recursive: true, force: true });
}

function buildRouterOnlyLifecycleEnv(
  dummyMemberProviderUrl: string,
  options: { appRoot: string; userDataDir: string; workspaceDir: string; configPath: string },
): Record<string, string> {
  const env = stringRecordEnv({
    ...process.env,
    SCIFORGE_DESKTOP_APP_ROOT: options.appRoot,
    SCIFORGE_DESKTOP_USER_DATA_DIR: options.userDataDir,
    SCIFORGE_DESKTOP_WORKSPACE_PATH: options.workspaceDir,
    SCIFORGE_CONFIG_PATH: options.configPath,
    SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS: 'sciforge-router',
    SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE: 'sciforge-runtime-default',
    SCIFORGE_MODEL_ROUTER_API_KEY: 'sciforge-desktop-lifecycle-router-key',
    SCIFORGE_RUNTIME_API_KEY: 'sciforge-desktop-lifecycle-router-key',
    SCIFORGE_RUNTIME_MODEL: 'sciforge-router',
    SCIFORGE_TEXT_PROVIDER: 'desktop-lifecycle-dummy-member',
    SCIFORGE_TEXT_BASE_URL: dummyMemberProviderUrl,
    SCIFORGE_TEXT_API_KEY: 'sciforge-desktop-lifecycle-dummy-member-key',
    SCIFORGE_TEXT_MODEL: 'sciforge-desktop-lifecycle-dummy-member-model',
  });
  deleteLegacyDirectProviderEnv(env);
  assertRouterOnlyLifecycleEnv(env, dummyMemberProviderUrl);
  return env;
}

function stringRecordEnv(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function deleteLegacyDirectProviderEnv(env: Record<string, string>): void {
  for (const key of [
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
    'SCIFORGE_PROXY_API_KEY_ENV',
    'SCIFORGE_PROXY_DEFAULT_MODEL',
    'SCIFORGE_PROXY_QUIET',
    'SCIFORGE_RUNTIME_BASE_URL',
  ]) {
    delete env[key];
  }
}

function assertRouterOnlyLifecycleEnv(env: Record<string, string>, dummyMemberProviderUrl: string): void {
  for (const key of [
    'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
    'SCIFORGE_PROXY_API_KEY_ENV',
    'SCIFORGE_PROXY_DEFAULT_MODEL',
    'SCIFORGE_PROXY_QUIET',
    'SCIFORGE_RUNTIME_BASE_URL',
  ]) {
    assert.equal(env[key], undefined, `desktop lifecycle must not inject legacy direct provider env: ${key}`);
  }
  assert.equal(env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, 'sciforge-router');
  assert.equal(env.SCIFORGE_RUNTIME_MODEL, env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS);
  assert.equal(env.SCIFORGE_RUNTIME_API_KEY, env.SCIFORGE_MODEL_ROUTER_API_KEY);
  assert.equal(env.SCIFORGE_TEXT_BASE_URL, dummyMemberProviderUrl);
  assert.equal(env.SCIFORGE_TEXT_PROVIDER, 'desktop-lifecycle-dummy-member');
  assert.equal(env.SCIFORGE_TEXT_MODEL, 'sciforge-desktop-lifecycle-dummy-member-model');
  assert.ok(env.SCIFORGE_TEXT_API_KEY, 'desktop lifecycle dummy member model key must stay router-member scoped');
}

function assertDynamicLoopbackConfig(config: DesktopRuntimeConfig): void {
  assert.equal(config.ports.length, 5);
  const byName = new Map(config.ports.map((port) => [port.name, port]));
  for (const name of ['control', 'ui', 'workspace-writer', 'model-router', 'runtime-codex'] as const) {
    const binding = byName.get(name);
    assert.ok(binding, `missing dynamic port binding: ${name}`);
    assert.equal(binding.requested, 0, `${name} should request an ephemeral port`);
    assert.equal(binding.conflict, false, `${name} should not report a fixed-port conflict`);
    assert.ok(binding.actual > 0, `${name} should bind a real ephemeral port`);
    assert.equal(binding.url, `http://127.0.0.1:${binding.actual}`);
    assert.ok(!/^517[3-9]$|^5180$/.test(String(binding.actual)), `${name} must not use a Vite dev-server port`);
  }
  assert.equal(config.runtimeControlUrl, byName.get('control')?.url);
  assert.equal(config.workspaceWriterBaseUrl, byName.get('workspace-writer')?.url);
  assert.equal(config.modelBaseUrl, `${byName.get('model-router')?.url}/v1`);
  assert.equal(config.runtimeCodexBaseUrl, byName.get('runtime-codex')?.url);
}

function classifySidecarHealth(health: DesktopHealth): {
  claimScope: 'diagnostic-only';
  ok: boolean;
  ready: boolean;
  serviceStates: Array<{ id: string; role: string; state: string; diagnostic?: string }>;
} {
  return {
    claimScope: 'diagnostic-only',
    ok: health.ok,
    ready: health.ready,
    serviceStates: (health.services ?? []).map((service) => ({
      id: service.id,
      role: service.role,
      state: service.state,
      diagnostic: service.lastError ?? service.signal ?? (service.exitCode == null ? undefined : `exitCode=${service.exitCode}`),
    })),
  };
}

async function startDummyProvider(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'dummy_provider_unavailable',
        message: `No real provider is available for desktop lifecycle smoke: ${req.method ?? 'GET'} ${req.url ?? '/'}`,
      },
    }));
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolvePort(address.port);
    });
  });
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
