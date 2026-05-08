import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'sciforge-dual-instance-'));
const mainPort = 24080 + Math.floor(Math.random() * 500);
const repairPort = mainPort + 1000;

const main = await startInstance({
  agentId: 'main-smoke',
  role: 'main',
  workspacePort: mainPort,
  uiPort: mainPort - 1,
  workspacePath: join(root, 'workspaces', 'main'),
  stateDir: join(root, 'state', 'main'),
  logDir: join(root, 'logs', 'main'),
  configPath: join(root, 'config.main.local.json'),
  counterpart: { agentId: 'repair-smoke', workspaceWriterUrl: `http://127.0.0.1:${repairPort}` },
});

const repair = await startInstance({
  agentId: 'repair-smoke',
  role: 'repair',
  workspacePort: repairPort,
  uiPort: repairPort - 1,
  workspacePath: join(root, 'workspaces', 'repair'),
  stateDir: join(root, 'state', 'repair'),
  logDir: join(root, 'logs', 'repair'),
  configPath: join(root, 'config.repair.local.json'),
  counterpart: { agentId: 'main-smoke', workspaceWriterUrl: `http://127.0.0.1:${mainPort}` },
});

try {
  const [mainManifest, repairManifest] = await Promise.all([
    readManifest(main.port),
    readManifest(repair.port),
  ]);

  assert.notEqual(mainManifest.agentId, repairManifest.agentId);
  assert.notEqual(mainManifest.workspacePath, repairManifest.workspacePath);
  assert.notEqual(mainManifest.stateDir, repairManifest.stateDir);
  assert.notEqual(mainManifest.logDir, repairManifest.logDir);
  assert.notEqual(mainManifest.configLocalPath, repairManifest.configLocalPath);
  assert.equal(mainManifest.agentServerBaseUrl, 'http://127.0.0.1:18080');
  assert.equal(repairManifest.agentServerBaseUrl, 'http://127.0.0.1:18080');

  await Promise.all([
    writeSnapshot(main.port, main.workspacePath, 'main-session'),
    writeSnapshot(repair.port, repair.workspacePath, 'repair-session'),
  ]);

  const mainMarker = JSON.parse(await readFile(join(main.stateDir, 'last-workspace.json'), 'utf8'));
  const repairMarker = JSON.parse(await readFile(join(repair.stateDir, 'last-workspace.json'), 'utf8'));
  assert.equal(mainMarker.workspacePath, main.workspacePath);
  assert.equal(repairMarker.workspacePath, repair.workspacePath);

  const issueId = 'feedback-42';
  const runId = 'a-writes-b-repair-result';
  const resultPayload = {
    id: runId,
    repairRunId: runId,
    verdict: 'fixed',
    status: 'fixed',
    summary: 'A wrote a structured repair result into B.',
    changedFiles: ['src/example.ts'],
    evidenceRefs: ['.sciforge/logs/typecheck.log'],
    metadata: {
      sourceInstanceId: main.agentId,
      tests: [{ command: 'npm run typecheck -- --pretty false', status: 'passed' }],
    },
  };
  let response = await fetch(`http://127.0.0.1:${repair.port}/api/sciforge/feedback/issues/${issueId}/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: repair.workspacePath,
      sourceInstanceId: main.agentId,
      result: resultPayload,
    }),
  });
  await assertOk(response);

  response = await fetch(`http://127.0.0.1:${repair.port}/api/sciforge/feedback/issues/${issueId}?workspacePath=${encodeURIComponent(repair.workspacePath)}`);
  await assertOk(response);
  const bundle = await response.json() as { issue: { repairResults: Array<{ id: string; summary: string; metadata?: Record<string, unknown> }> } };
  assert.equal(bundle.issue.repairResults.length, 1);
  assert.equal(bundle.issue.repairResults[0].id, runId);
  assert.equal(bundle.issue.repairResults[0].summary, resultPayload.summary);
  assert.equal(bundle.issue.repairResults[0].metadata?.sourceInstanceId, main.agentId);

  await stat(join(repair.workspacePath, '.sciforge', 'feedback', 'repair-results', `${runId}.json`));
  await assertMissing(join(main.workspacePath, '.sciforge', 'feedback', 'repair-results', `${runId}.json`));

  console.log('[ok] dual instance dev writer manifests, state dirs, and cross-instance repair result isolation');
} finally {
  main.child.kill('SIGTERM');
  repair.child.kill('SIGTERM');
  await rm(root, { recursive: true, force: true });
}

async function startInstance(options: {
  agentId: string;
  role: string;
  workspacePort: number;
  uiPort: number;
  workspacePath: string;
  stateDir: string;
  logDir: string;
  configPath: string;
  counterpart: Record<string, unknown>;
}) {
  await mkdir(options.workspacePath, { recursive: true });
  await mkdir(options.stateDir, { recursive: true });
  await mkdir(options.logDir, { recursive: true });
  await writeFile(options.configPath, JSON.stringify({
    sciforge: {
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: `http://127.0.0.1:${options.workspacePort}`,
      workspacePath: options.workspacePath,
    },
  }, null, 2));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCIFORGE_INSTANCE_ID: options.agentId,
      SCIFORGE_INSTANCE_ROLE: options.role,
      SCIFORGE_UI_PORT: String(options.uiPort),
      SCIFORGE_WORKSPACE_PORT: String(options.workspacePort),
      SCIFORGE_WORKSPACE_PATH: options.workspacePath,
      SCIFORGE_STATE_DIR: options.stateDir,
      SCIFORGE_LOG_DIR: options.logDir,
      SCIFORGE_CONFIG_PATH: options.configPath,
      SCIFORGE_COUNTERPART_JSON: JSON.stringify(options.counterpart),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(options.workspacePort, child);
  return {
    agentId: options.agentId,
    port: options.workspacePort,
    workspacePath: options.workspacePath,
    stateDir: options.stateDir,
    logDir: options.logDir,
    configPath: options.configPath,
    child,
  };
}

async function readManifest(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/instance/manifest`);
  await assertOk(response);
  const json = await response.json() as { manifest: Record<string, string | number | undefined> };
  return json.manifest;
}

async function writeSnapshot(port: number, workspacePath: string, sessionId: string) {
  const instanceId = sessionId.startsWith('main') ? 'main-smoke' : 'repair-smoke';
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      config: { workspacePath },
      state: {
        instanceId,
        sessionsByScenario: {
          smoke: {
            sessionId,
            messages: [{ id: `message-${sessionId}`, role: 'user', content: sessionId }],
            artifacts: [],
            executionUnits: [],
            notebook: [],
          },
        },
        feedbackRequests: [{
          id: 'request-feedback-42',
          title: 'Dual instance repair smoke',
          feedbackIds: ['feedback-42'],
          prompt: 'Verify cross-instance repair result handoff.',
        }],
        feedbackComments: [{
          id: 'feedback-42',
          requestId: 'request-feedback-42',
          status: 'open',
          priority: 'normal',
          comment: 'Smoke feedback issue for cross-instance repair result.',
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z',
          runtime: { page: 'smoke', scenarioId: 'smoke', sessionId },
        }],
      },
    }),
  });
  await assertOk(response);
}

async function waitForHealth(port: number, child: ChildProcess) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const stderr = await readStream(child.stderr);
  throw new Error(`workspace server did not start on ${port}\n${stderr}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) {
    assert.equal(response.status, 200, await response.text());
  }
}

async function assertMissing(path: string) {
  await assert.rejects(() => stat(path), /ENOENT/);
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Buffer.concat(chunks).toString('utf8');
}
