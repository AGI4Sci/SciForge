import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = git(['rev-parse', '--show-toplevel']);
const root = await mkdtemp(join(tmpdir(), 'sciforge-dual-worktree-'));
const branchPrefix = `codex/t092-smoke-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const ports = randomPorts();
const worktrees = {
  a: {
    label: 'A',
    agentId: 'worktree-a-smoke',
    role: 'main',
    path: join(root, 'SciForge-A'),
    branch: `${branchPrefix}-a`,
    port: ports.a,
    uiPort: ports.a - 1,
    stateDir: join(root, 'state', 'A'),
    logDir: join(root, 'logs', 'A'),
    configPath: join(root, 'config.a.local.json'),
  },
  b: {
    label: 'B',
    agentId: 'worktree-b-smoke',
    role: 'repair',
    path: join(root, 'SciForge-B'),
    branch: `${branchPrefix}-b`,
    port: ports.b,
    uiPort: ports.b - 1,
    stateDir: join(root, 'state', 'B'),
    logDir: join(root, 'logs', 'B'),
    configPath: join(root, 'config.b.local.json'),
  },
};

let a: StartedInstance | undefined;
let b: StartedInstance | undefined;

try {
  createWorktree(worktrees.a.path, worktrees.a.branch);
  createWorktree(worktrees.b.path, worktrees.b.branch);

  a = await startInstance({
    ...worktrees.a,
    counterpart: { agentId: worktrees.b.agentId, workspaceWriterUrl: `http://127.0.0.1:${worktrees.b.port}`, workspacePath: worktrees.b.path },
  });
  b = await startInstance({
    ...worktrees.b,
    counterpart: { agentId: worktrees.a.agentId, workspaceWriterUrl: `http://127.0.0.1:${worktrees.a.port}`, workspacePath: worktrees.a.path },
  });

  const [manifestA, manifestB] = await Promise.all([
    readManifest(a.port, a.workspacePath),
    readManifest(b.port, b.workspacePath),
  ]);

  assert.equal(manifestA.repo.detected, true);
  assert.equal(manifestB.repo.detected, true);
  assert.equal(await realpath(manifestA.repo.root), await realpath(a.workspacePath));
  assert.equal(await realpath(manifestB.repo.root), await realpath(b.workspacePath));
  assert.notEqual(manifestA.repo.root, manifestB.repo.root);
  assert.notEqual(manifestA.workspacePath, manifestB.workspacePath);
  assert.notEqual(manifestA.stateDir, manifestB.stateDir);
  assert.notEqual(manifestA.configLocalPath, manifestB.configLocalPath);

  await Promise.all([
    writeSnapshot(a.port, a.workspacePath, 'session-a', 'bootstrap-a'),
    writeSnapshot(b.port, b.workspacePath, 'session-b', 'bootstrap-b'),
  ]);

  await writeSnapshot(b.port, b.workspacePath, 'session-b', 'patch-from-a');
  await writeRepairResult({
    port: b.port,
    targetWorkspacePath: b.workspacePath,
    issueId: 'feedback-42',
    sourceInstanceId: a.agentId,
    runId: 'a-writes-b-repair-result',
    summary: 'A wrote a repair result into B worktree.',
  });
  await assertPresent(join(b.workspacePath, '.sciforge', 'artifacts', 'session-b-patch-from-a.json'));
  await assertPresent(join(b.workspacePath, '.sciforge', 'feedback', 'repair-results', 'a-writes-b-repair-result.json'));
  await assertMissing(join(a.workspacePath, '.sciforge', 'artifacts', 'session-b-patch-from-a.json'));
  await assertMissing(join(a.workspacePath, '.sciforge', 'feedback', 'repair-results', 'a-writes-b-repair-result.json'));

  await writeSnapshot(a.port, a.workspacePath, 'session-a', 'patch-from-b');
  await writeRepairResult({
    port: a.port,
    targetWorkspacePath: a.workspacePath,
    issueId: 'feedback-42',
    sourceInstanceId: b.agentId,
    runId: 'b-writes-a-repair-result',
    summary: 'B wrote a repair result into A worktree.',
  });
  await assertPresent(join(a.workspacePath, '.sciforge', 'artifacts', 'session-a-patch-from-b.json'));
  await assertPresent(join(a.workspacePath, '.sciforge', 'feedback', 'repair-results', 'b-writes-a-repair-result.json'));
  await assertMissing(join(b.workspacePath, '.sciforge', 'artifacts', 'session-a-patch-from-b.json'));
  await assertMissing(join(b.workspacePath, '.sciforge', 'feedback', 'repair-results', 'b-writes-a-repair-result.json'));

  console.log('[ok] dual worktree instance manifests and cross-worktree writer isolation');
} finally {
  a?.child.kill('SIGTERM');
  b?.child.kill('SIGTERM');
  await waitForExit(a?.child);
  await waitForExit(b?.child);
  removeWorktree(worktrees.a.path);
  removeWorktree(worktrees.b.path);
  deleteBranch(worktrees.a.branch);
  deleteBranch(worktrees.b.branch);
  await rm(root, { recursive: true, force: true });
}

type StartedInstance = {
  agentId: string;
  port: number;
  workspacePath: string;
  stateDir: string;
  configPath: string;
  child: ChildProcess;
};

async function startInstance(options: {
  label: string;
  agentId: string;
  role: string;
  path: string;
  port: number;
  uiPort: number;
  stateDir: string;
  logDir: string;
  configPath: string;
  counterpart: Record<string, unknown>;
}): Promise<StartedInstance> {
  await writeFile(options.configPath, JSON.stringify({
    sciforge: {
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: `http://127.0.0.1:${options.port}`,
      workspacePath: options.path,
    },
  }, null, 2));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SCIFORGE_INSTANCE_ID: options.agentId,
      SCIFORGE_INSTANCE_ROLE: options.role,
      SCIFORGE_UI_PORT: String(options.uiPort),
      SCIFORGE_WORKSPACE_PORT: String(options.port),
      SCIFORGE_WORKSPACE_PATH: options.path,
      SCIFORGE_STATE_DIR: options.stateDir,
      SCIFORGE_LOG_DIR: options.logDir,
      SCIFORGE_CONFIG_PATH: options.configPath,
      SCIFORGE_COUNTERPART_JSON: JSON.stringify(options.counterpart),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(options.port, child);
  return {
    agentId: options.agentId,
    port: options.port,
    workspacePath: options.path,
    stateDir: options.stateDir,
    configPath: options.configPath,
    child,
  };
}

async function readManifest(port: number, workspacePath: string) {
  const url = new URL(`http://127.0.0.1:${port}/api/sciforge/instance/manifest`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetch(url);
  await assertOk(response);
  const json = await response.json() as { manifest: {
    workspacePath: string;
    stateDir: string;
    configLocalPath: string;
    repo: { detected: boolean; root: string };
  } };
  return json.manifest;
}

async function writeSnapshot(port: number, workspacePath: string, sessionId: string, artifactId: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      config: { workspacePath },
      state: stateWithFeedback(sessionId, artifactId),
    }),
  });
  await assertOk(response);
}

function stateWithFeedback(sessionId: string, artifactId: string) {
  return {
    instanceId: sessionId.startsWith('session-a') ? worktrees.a.agentId : worktrees.b.agentId,
    sessionsByScenario: {
      smoke: {
        sessionId,
        messages: [{ id: `message-${sessionId}`, role: 'user', content: sessionId }],
        artifacts: [{
          id: artifactId,
          type: 'patch-artifact',
          title: artifactId,
          path: `.sciforge/patches/${artifactId}.patch`,
        }],
        executionUnits: [],
        notebook: [],
      },
    },
    feedbackRequests: [{
      id: 'request-feedback-42',
      title: 'Dual worktree repair smoke',
      feedbackIds: ['feedback-42'],
      prompt: 'Verify cross-worktree repair result handoff.',
    }],
    feedbackComments: [{
      id: 'feedback-42',
      requestId: 'request-feedback-42',
      status: 'open',
      priority: 'normal',
      comment: 'Smoke feedback issue for cross-worktree repair result.',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
      runtime: { page: 'smoke', scenarioId: 'smoke', sessionId },
    }],
  };
}

async function writeRepairResult(input: {
  port: number;
  targetWorkspacePath: string;
  issueId: string;
  sourceInstanceId: string;
  runId: string;
  summary: string;
}) {
  const response = await fetch(`http://127.0.0.1:${input.port}/api/sciforge/feedback/issues/${input.issueId}/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.targetWorkspacePath,
      sourceInstanceId: input.sourceInstanceId,
      result: {
        id: input.runId,
        repairRunId: input.runId,
        verdict: 'fixed',
        summary: input.summary,
        changedFiles: ['src/example.ts'],
        refs: { patchRef: `.sciforge/artifacts/${input.runId}.json` },
        metadata: { sourceInstanceId: input.sourceInstanceId },
      },
    }),
  });
  await assertOk(response);
}

function createWorktree(path: string, branch: string) {
  runGit(['worktree', 'add', '-b', branch, path, 'HEAD']);
}

function removeWorktree(path: string) {
  spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: repoRoot, stdio: 'ignore' });
}

function deleteBranch(branch: string) {
  spawnSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'ignore' });
}

function runGit(args: string[]) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
}

function git(args: string[]) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function randomPorts() {
  const a = 25080 + Math.floor(Math.random() * 1000);
  return { a, b: a + 1500 };
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
    await new Promise((resolveHealth) => setTimeout(resolveHealth, 100));
  }
  const stderr = await readStream(child.stderr);
  throw new Error(`workspace server did not start on ${port}\n${stderr}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) {
    assert.equal(response.status, 200, await response.text());
  }
}

async function assertPresent(path: string) {
  await stat(path);
}

async function assertMissing(path: string) {
  await assert.rejects(() => stat(path), /ENOENT/);
}

async function waitForExit(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveExit) => {
    child.once('exit', resolveExit);
    setTimeout(resolveExit, 1500);
  });
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolveRead) => setTimeout(resolveRead, 50));
  return Buffer.concat(chunks).toString('utf8');
}
