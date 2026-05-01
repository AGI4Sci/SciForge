import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-workspace-file-api-'));
const port = 23080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIOAGENT_WORKSPACE_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await mkdir(join(workspace, 'notes'), { recursive: true });
  const filePath = join(workspace, 'notes', 'report.md');
  await writeFile(filePath, '# Draft\n\nhello', 'utf8');
  await writeFile(join(workspace, '.DS_Store'), 'ignored before', 'utf8');
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/bioagent/workspace/list?path=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const listed = await response.json() as { entries: Array<{ name: string; kind: string; size?: number; modifiedAt?: string }> };
  assert.ok(listed.entries.some((entry) => entry.name === 'notes' && entry.kind === 'folder'));
  assert.ok(listed.entries.some((entry) => entry.name === '.DS_Store' && entry.kind === 'file'));

  response = await fetch(`${baseUrl}/api/bioagent/workspace/file?path=${encodeURIComponent(filePath)}`);
  await assertOk(response);
  const opened = await response.json() as { file: { name: string; content: string; language: string; size: number } };
  assert.equal(opened.file.name, 'report.md');
  assert.equal(opened.file.content, '# Draft\n\nhello');
  assert.equal(opened.file.language, 'markdown');
  assert.ok(opened.file.size > 0);

  response = await fetch(`${baseUrl}/api/bioagent/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content: '# Draft\n\nhello world' }),
  });
  await assertOk(response);
  assert.equal(await readFile(filePath, 'utf8'), '# Draft\n\nhello world');

  const renamedPath = join(workspace, 'notes', 'renamed.md');
  response = await fetch(`${baseUrl}/api/bioagent/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rename', path: filePath, targetPath: renamedPath }),
  });
  await assertOk(response);
  assert.equal(await readFile(renamedPath, 'utf8'), '# Draft\n\nhello world');

  response = await fetch(`${baseUrl}/api/bioagent/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', path: renamedPath }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/bioagent/workspace/file?path=${encodeURIComponent(renamedPath)}`);
  assert.equal(response.status, 400);

  console.log('[ok] workspace file APIs list, read, write, rename, and delete real files');
} finally {
  child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
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
