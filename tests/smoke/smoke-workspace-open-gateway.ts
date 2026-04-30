import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-workspace-open-'));
const port = 24080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIOAGENT_WORKSPACE_PORT: String(port),
    BIOAGENT_WORKSPACE_OPEN_DRY_RUN: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await mkdir(join(workspace, 'reports'), { recursive: true });
  const reportPath = join(workspace, 'reports', 'summary.md');
  const scriptPath = join(workspace, 'reports', 'run.sh');
  await writeFile(reportPath, '# Summary\n', 'utf8');
  await writeFile(scriptPath, 'echo unsafe\n', 'utf8');
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await postOpen(baseUrl, {
    workspacePath: workspace,
    action: 'open-external',
    path: reportPath,
  });
  await assertOk(response);
  const opened = await response.json() as { dryRun?: boolean; path?: string };
  assert.equal(opened.dryRun, true);
  assert.equal(opened.path, reportPath);

  response = await postOpen(baseUrl, {
    workspacePath: workspace,
    action: 'reveal-in-folder',
    path: 'reports',
  });
  await assertOk(response);

  response = await postOpen(baseUrl, {
    workspacePath: workspace,
    action: 'open-external',
    path: scriptPath,
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /blocked high-risk file type/i);

  response = await postOpen(baseUrl, {
    workspacePath: workspace,
    action: 'reveal-in-folder',
    path: join(workspace, '..', 'outside.md'),
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /outside the active workspace/i);

  console.log('[ok] workspace open gateway opens only workspace-safe paths and blocks risky files');
} finally {
  child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
}

function postOpen(baseUrl: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/bioagent/workspace/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForHealth(portNumber: number) {
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
  const stderr = await readStream(child.stderr);
  throw new Error(`workspace server did not start on ${portNumber}\n${stderr}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) {
    assert.equal(response.status, 200, await response.text());
  }
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Buffer.concat(chunks).toString('utf8');
}
