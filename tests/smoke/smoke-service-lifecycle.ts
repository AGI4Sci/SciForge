import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

type WorkspaceHealth = {
  ok?: boolean;
  service?: string;
  schemaVersion?: number;
  pid?: number;
  startedAt?: string;
  lifecycleToken?: string;
  capabilities?: string[];
};

const repoRoot = process.cwd();
const port = await freePort();
const root = await mkdtemp(join(tmpdir(), 'sciforge-service-lifecycle-'));

try {
  const first = await startWorkspaceServer({ port, root, token: 'first-lifecycle-token' });
  try {
    const firstHealth = await waitForWorkspaceHealth(port, 'first-lifecycle-token');
    assert.equal(firstHealth.service, 'sciforge-workspace-writer');
    assert.equal(firstHealth.schemaVersion, 1);
    assert.equal(firstHealth.lifecycleToken, 'first-lifecycle-token');
    assert.ok(firstHealth.capabilities?.includes('workspace-snapshot'));
    assert.equal(typeof firstHealth.pid, 'number');
    assert.equal(typeof firstHealth.startedAt, 'string');

    await stopProcess(first);
    await waitForOffline(port);

    const second = await startWorkspaceServer({ port, root, token: 'second-lifecycle-token' });
    try {
      const secondHealth = await waitForWorkspaceHealth(port, 'second-lifecycle-token');
      assert.equal(secondHealth.service, 'sciforge-workspace-writer');
      assert.equal(secondHealth.lifecycleToken, 'second-lifecycle-token');
      assert.notEqual(secondHealth.pid, firstHealth.pid);
      assert.notEqual(secondHealth.startedAt, firstHealth.startedAt);
    } finally {
      await stopProcess(second);
    }
  } finally {
    await stopProcess(first);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('service lifecycle smoke passed');

async function startWorkspaceServer({ port, root, token }: { port: number; root: string; token: string }) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SCIFORGE_WORKSPACE_PORT: String(port),
      SCIFORGE_UI_PORT: '0',
      SCIFORGE_AGENT_SERVER_AUTOSTART: '0',
      SCIFORGE_STATE_DIR: join(root, '.state'),
      SCIFORGE_LOG_DIR: join(root, '.state', 'logs'),
      SCIFORGE_CONFIG_PATH: join(root, 'config.local.json'),
      SCIFORGE_WORKSPACE_PATH: join(root, 'workspace'),
      SCIFORGE_SERVICE_LIFECYCLE_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') return;
    output += `\nworkspace server exited with ${signal || `code ${code}`}`;
  });
  await waitForWorkspaceHealth(port, token, () => output);
  return child;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    sleep(2000).then(() => false),
  ]);
  if (!exited && child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(1000),
    ]);
  }
}

async function waitForWorkspaceHealth(port: number, token: string, output?: () => string) {
  const deadline = Date.now() + 15_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const health = await readHealth(port);
      if (health.ok && health.service === 'sciforge-workspace-writer' && health.lifecycleToken === token) return health;
      lastError = JSON.stringify(health);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`workspace writer did not become healthy on ${port}: ${lastError}\n${output?.() ?? ''}`);
}

async function waitForOffline(port: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readHealth(port);
    } catch {
      return;
    }
    await sleep(120);
  }
  throw new Error(`workspace writer still accepted health requests on ${port}`);
}

async function readHealth(port: number): Promise<WorkspaceHealth> {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
  return await response.json() as WorkspaceHealth;
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate a TCP port')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
