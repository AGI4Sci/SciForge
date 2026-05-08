import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRepairHandoff } from '../../src/runtime/repair-handoff-runner.js';

const root = await mkdtemp(join(tmpdir(), 'sciforge-repair-handoff-'));
const executorRepo = join(root, 'SciForge-A');
const targetRepo = join(root, 'SciForge-B');
const executorStateDir = join(executorRepo, '.sciforge', 'state');
const executorLogDir = join(executorRepo, '.sciforge', 'logs');
const executorConfigLocalPath = join(executorRepo, 'config.local.json');
const targetResults: Record<string, unknown>[] = [];
const targetRuns: Record<string, unknown>[] = [];

const agentServer = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/agent-server/runs') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const agent = isRecord(body.agent) ? body.agent : {};
  const cwd = typeof agent.workingDirectory === 'string' ? agent.workingDirectory : '';
  assert.ok(cwd.includes(join('SciForge-B', '.sciforge', 'repair-worktrees')));
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(join(cwd, 'src', 'fixed.txt'), 'repaired\n', 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-repair-run',
        status: 'completed',
        output: { result: 'patched target worktree' },
      },
    },
  }));
});

const targetWriter = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  if (String(req.url).endsWith('/repair-runs')) {
    targetRuns.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, run: { id: body.id, issueId: 'feedback-1', status: 'running', startedAt: new Date().toISOString() } }));
    return;
  }
  if (String(req.url).endsWith('/repair-result')) {
    targetResults.push(body);
    await mkdir(join(targetRepo, '.sciforge', 'feedback', 'repair-results'), { recursive: true });
    await writeFile(join(targetRepo, '.sciforge', 'feedback', 'repair-results', 'latest.json'), JSON.stringify(body.result, null, 2), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: body.result }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

try {
  await initRepo(executorRepo);
  await initRepo(targetRepo);
  await mkdir(executorStateDir, { recursive: true });
  await mkdir(executorLogDir, { recursive: true });
  await writeFile(executorConfigLocalPath, '{}\n', 'utf8');
  await listen(agentServer);
  await listen(targetWriter);
  const agentAddress = agentServer.address();
  const targetAddress = targetWriter.address();
  assert.ok(agentAddress && typeof agentAddress === 'object');
  assert.ok(targetAddress && typeof targetAddress === 'object');

  const result = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-1',
      title: 'Fix B',
      comment: { id: 'feedback-1', comment: 'Create the repaired marker in B only.' },
    },
    expectedTests: ['test -f src/fixed.txt && grep -q repaired src/fixed.txt'],
    githubSyncRequired: false,
    agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    repairRunId: 'runner-focused',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
  });

  assert.equal(result.verdict, 'fixed');
  assert.deepEqual(result.changedFiles, ['src/fixed.txt']);
  assert.equal(result.executorInstance.id, 'A');
  assert.equal(result.targetInstance.id, 'B');
  assert.match(result.refs.branch ?? '', /^codex\/repair-handoff\/B\/feedback-1\//);
  const targetRepoReal = await realpath(targetRepo);
  assert.ok(result.refs.worktreePath?.startsWith(join(targetRepoReal, '.sciforge', 'repair-worktrees')));
  assert.equal(await fileText(join(result.refs.worktreePath ?? '', 'src', 'fixed.txt')), 'repaired\n');
  await assertMissing(join(executorRepo, 'src', 'fixed.txt'));
  await assertMissing(join(targetRepo, 'src', 'fixed.txt'));
  assert.equal(await exists(result.diffRef ?? ''), true);
  assert.match(await fileText(result.diffRef ?? ''), /src\/fixed\.txt/);
  assert.equal(targetRuns.length, 1);
  assert.equal(targetResults.length, 1);
  assert.equal((targetResults[0].result as Record<string, unknown>).diffRef, result.diffRef);

  await assert.rejects(
    () => runRepairHandoff({
      executorInstance: { id: 'A', workspacePath: executorRepo },
      targetInstance: { id: 'A', workspacePath: executorRepo },
      targetWorkspacePath: executorRepo,
      targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
      issueBundle: { id: 'feedback-closed' },
      expectedTests: [],
      githubSyncRequired: false,
      agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    }, {
      executorRepoPath: executorRepo,
      executorStateDir,
      executorLogDir,
      executorConfigLocalPath,
    }),
    /targetWorkspacePath cannot equal the executor repo\/worktree/i,
  );

  console.log('[ok] repair handoff runner executes in target isolated worktree and fails closed for executor paths');
} finally {
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => targetWriter.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}

async function initRepo(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, ['init', '-q']);
  await git(path, ['config', 'user.email', 'sciforge@example.test']);
  await git(path, ['config', 'user.name', 'SciForge Test']);
  await writeFile(join(path, 'README.md'), `# ${path}\n`, 'utf8');
  await git(path, ['add', 'README.md']);
  await git(path, ['commit', '-q', '-m', 'init']);
}

async function git(cwd: string, args: string[]) {
  const result = await runCommand('git', args, cwd);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', (err) => resolveRun({ exitCode: 1, stdout: '', stderr: err.message }));
    child.on('close', (code) => resolveRun({
      exitCode: typeof code === 'number' ? code : 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertMissing(path: string) {
  assert.equal(await exists(path), false, `${path} should not exist`);
}

async function fileText(path: string) {
  return readFile(path, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
