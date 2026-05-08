import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'sciforge-stable-version-'));
const stateDir = join(root, 'state-current');
const peerStateDir = join(root, 'state-peer');
const port = 24500 + Math.floor(Math.random() * 1000);
const workspacePath = process.cwd();
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SCIFORGE_INSTANCE_ID: 'stable-smoke-main',
    SCIFORGE_INSTANCE_ROLE: 'main',
    SCIFORGE_WORKSPACE_PORT: String(port),
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    SCIFORGE_STATE_DIR: stateDir,
    SCIFORGE_LOG_DIR: join(root, 'logs-current'),
    SCIFORGE_CONFIG_PATH: join(root, 'config.local.json'),
    SCIFORGE_COUNTERPART_JSON: JSON.stringify({
      agentId: 'stable-smoke-peer',
      workspaceWriterUrl: 'http://127.0.0.1:1',
      stateDir: peerStateDir,
    }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForHealth(port, child);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/sciforge/instance/stable-version`);
  await assertOk(response);
  let json = await response.json() as { stableVersion?: unknown; path: string };
  assert.equal(json.stableVersion, undefined);
  assert.equal(json.path, join(stateDir, 'stable-version.json'));

  response = await fetch(`${baseUrl}/api/sciforge/instance/stable-version/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      confirm: true,
      promotedBy: 'smoke-test',
      versionLabel: 'should-not-promote',
      tests: [],
    }),
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /test evidence/i);
  await assertMissing(join(stateDir, 'stable-version.json'));

  response = await fetch(`${baseUrl}/api/sciforge/instance/stable-version/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      promotedBy: 'smoke-test',
      versionLabel: 'missing-confirm',
      tests: [{ name: 'typecheck', command: 'npm run typecheck', status: 'passed', summary: 'passed' }],
    }),
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /confirmation/i);
  await assertMissing(join(stateDir, 'stable-version.json'));

  response = await fetch(`${baseUrl}/api/sciforge/instance/stable-version/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      confirm: true,
      promotedBy: 'smoke-test',
      versionLabel: 'stable-smoke',
      tests: [
        {
          name: 'typecheck',
          command: 'npm run typecheck',
          status: 'passed',
          summary: 'TypeScript accepted the stable registry contract.',
          outputRef: '.sciforge/logs/typecheck.log',
        },
      ],
      syncState: { status: 'local-stable' },
    }),
  });
  await assertOk(response);
  const promotedJson = await response.json() as { stableVersion: { instanceId: string; versionLabel: string; tests: unknown[]; syncState: { status: string } }; path: string };
  assert.equal(promotedJson.path, join(stateDir, 'stable-version.json'));
  assert.equal(promotedJson.stableVersion.instanceId, 'stable-smoke-main');
  assert.equal(promotedJson.stableVersion.versionLabel, 'stable-smoke');
  assert.equal(promotedJson.stableVersion.tests.length, 1);
  assert.equal(promotedJson.stableVersion.syncState.status, 'local-stable');

  const saved = JSON.parse(await readFile(join(stateDir, 'stable-version.json'), 'utf8')) as { versionLabel: string };
  assert.equal(saved.versionLabel, 'stable-smoke');
  await assertMissing(join(peerStateDir, 'stable-version.json'));

  const beforeStateFiles = await listFiles(stateDir);
  response = await fetch(`${baseUrl}/api/sciforge/instance/stable-version/sync-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      sourceStableVersion: promotedJson.stableVersion,
      testRequirements: [{ name: 'typecheck', command: 'npm run typecheck', required: true, reason: 'contract check' }],
    }),
  });
  await assertOk(response);
  const planJson = await response.json() as { plan: { source: { commit?: string }; target: { instanceId: string }; backupPoint: { registryPath: string }; rollback: { prohibitedActions: string[] }; writes: unknown[] } };
  assert.equal(planJson.plan.target.instanceId, 'stable-smoke-main');
  assert.equal(planJson.plan.backupPoint.registryPath, join(stateDir, 'stable-version.json'));
  assert.deepEqual(planJson.plan.writes, []);
  assert.ok(planJson.plan.rollback.prohibitedActions.includes('git reset --hard'));
  assert.deepEqual(await listFiles(stateDir), beforeStateFiles);
  await assertMissing(join(peerStateDir, 'stable-version.json'));

  response = await fetch(`${baseUrl}/api/sciforge/instance/manifest?workspacePath=${encodeURIComponent(workspacePath)}`);
  await assertOk(response);
  const manifestJson = await response.json() as { manifest: { stableVersion?: { versionLabel: string }; capabilities: string[] } };
  assert.equal(manifestJson.manifest.stableVersion?.versionLabel, 'stable-smoke');
  assert.ok(manifestJson.manifest.capabilities.includes('stable-version-registry'));

  console.log('[ok] stable version registry requires evidence, plans without writes, and stays in current stateDir');
} finally {
  child.kill('SIGTERM');
  await waitForExit(child);
  await rm(root, { recursive: true, force: true });
}

async function waitForHealth(portNumber: number, process: ChildProcess) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace server did not start on ${portNumber}\n${await readStream(process.stderr)}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) assert.equal(response.status, 200, await response.text());
}

async function assertMissing(path: string) {
  await assert.rejects(() => stat(path), /ENOENT/);
}

async function listFiles(path: string) {
  return readdir(path).then((entries) => entries.sort(), () => []);
}

async function waitForExit(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise((resolve) => process.once('exit', resolve));
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Buffer.concat(chunks).toString('utf8');
}
