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
  const imagePath = join(workspace, 'notes', 'pixel.png');
  await writeFile(filePath, '# Draft\n\nhello', 'utf8');
  await writeFile(imagePath, Buffer.from('iVBORw0KGgo=', 'base64'));
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

  response = await fetch(`${baseUrl}/api/bioagent/workspace/file?path=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const openedRelative = await response.json() as { file: { path: string; name: string; content: string } };
  assert.equal(openedRelative.file.path, filePath);
  assert.equal(openedRelative.file.name, 'report.md');
  assert.equal(openedRelative.file.content, '# Draft\n\nhello');

  response = await fetch(`${baseUrl}/api/bioagent/preview/descriptor?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const markdownDescriptor = await response.json() as { descriptor: { kind: string; inlinePolicy: string; rawUrl: string; actions: string[]; derivatives: Array<{ kind: string; status: string }> } };
  assert.equal(markdownDescriptor.descriptor.kind, 'markdown');
  assert.equal(markdownDescriptor.descriptor.inlinePolicy, 'inline');
  assert.ok(markdownDescriptor.descriptor.rawUrl.includes('/api/bioagent/preview/raw'));
  assert.ok(markdownDescriptor.descriptor.actions.includes('open-inline'));

  response = await fetch(`${baseUrl}/api/bioagent/preview/raw?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`, {
    headers: { Range: 'bytes=0-6' },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), '# Draft');

  response = await fetch(`${baseUrl}/api/bioagent/preview/derivative?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}&kind=text`);
  await assertOk(response);
  const textDerivative = await response.json() as { derivative: { kind: string; status: string; ref: string; mimeType: string } };
  assert.equal(textDerivative.derivative.kind, 'text');
  assert.equal(textDerivative.derivative.status, 'available');
  assert.equal(textDerivative.derivative.mimeType, 'text/plain');

  response = await fetch(`${baseUrl}/api/bioagent/preview/descriptor?ref=${encodeURIComponent('../outside.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  assert.equal(response.status, 400);

  response = await fetch(`${baseUrl}/api/bioagent/workspace/file?path=${encodeURIComponent(imagePath)}`);
  await assertOk(response);
  const image = await response.json() as { file: { name: string; content: string; language: string; encoding?: string; mimeType?: string } };
  assert.equal(image.file.name, 'pixel.png');
  assert.equal(image.file.language, 'image');
  assert.equal(image.file.encoding, 'base64');
  assert.equal(image.file.mimeType, 'image/png');
  assert.equal(image.file.content, 'iVBORw0KGgo=');

  response = await fetch(`${baseUrl}/api/bioagent/preview/descriptor?ref=${encodeURIComponent(imagePath)}`);
  await assertOk(response);
  const imageDescriptor = await response.json() as { descriptor: { kind: string; inlinePolicy: string; derivatives: Array<{ kind: string; status: string }>; actions: string[] } };
  assert.equal(imageDescriptor.descriptor.kind, 'image');
  assert.equal(imageDescriptor.descriptor.inlinePolicy, 'stream');
  assert.ok(imageDescriptor.descriptor.derivatives.some((item) => item.kind === 'thumb' && item.status === 'lazy'));
  assert.ok(imageDescriptor.descriptor.actions.includes('select-region'));

  response = await fetch(`${baseUrl}/api/bioagent/preview/derivative?ref=${encodeURIComponent(imagePath)}&kind=thumb`);
  await assertOk(response);
  const thumbDerivative = await response.json() as { derivative: { kind: string; status: string; mimeType: string } };
  assert.equal(thumbDerivative.derivative.kind, 'thumb');
  assert.equal(thumbDerivative.derivative.status, 'available');
  assert.equal(thumbDerivative.derivative.mimeType, 'image/png');

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

  console.log('[ok] workspace file APIs and preview contract cover list/read/write/raw-range/descriptor/derivative/delete');
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
