import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-workspace-file-api-'));
const outsideDir = await mkdtemp(join(tmpdir(), 'sciforge-workspace-file-api-outside-'));
const port = 23080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SCIFORGE_WORKSPACE_PORT: String(port),
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

  let response = await fetch(`${baseUrl}/api/sciforge/workspace/list?path=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const listed = await response.json() as { entries: Array<{ name: string; kind: string; size?: number; modifiedAt?: string }> };
  assert.ok(listed.entries.some((entry) => entry.name === 'notes' && entry.kind === 'folder'));
  assert.ok(listed.entries.some((entry) => entry.name === '.DS_Store' && entry.kind === 'file'));

  response = await fetch(`${baseUrl}/api/sciforge/workspace/file?path=${encodeURIComponent(filePath)}`);
  await assertOk(response);
  const opened = await response.json() as { file: { name: string; content: string; language: string; size: number } };
  assert.equal(opened.file.name, 'report.md');
  assert.equal(opened.file.content, '# Draft\n\nhello');
  assert.equal(opened.file.language, 'markdown');
  assert.ok(opened.file.size > 0);

  response = await fetch(`${baseUrl}/api/sciforge/workspace/file?path=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const openedRelative = await response.json() as { file: { path: string; name: string; content: string } };
  assert.equal(openedRelative.file.path, filePath);
  assert.equal(openedRelative.file.name, 'report.md');
  assert.equal(openedRelative.file.content, '# Draft\n\nhello');

  response = await fetch(`${baseUrl}/api/sciforge/preview/descriptor?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const markdownDescriptor = await response.json() as { descriptor: { kind: string; inlinePolicy: string; rawUrl: string; actions: string[]; derivatives: Array<{ kind: string; status: string }> } };
  assert.equal(markdownDescriptor.descriptor.kind, 'markdown');
  assert.equal(markdownDescriptor.descriptor.inlinePolicy, 'inline');
  assert.ok(markdownDescriptor.descriptor.rawUrl.includes('/api/sciforge/preview/raw'));
  assert.ok(markdownDescriptor.descriptor.actions.includes('open-inline'));

  response = await fetch(`${baseUrl}/api/sciforge/preview/raw?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}`, {
    headers: { Range: 'bytes=0-6' },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), '# Draft');

  response = await fetch(`${baseUrl}/api/sciforge/preview/derivative?ref=${encodeURIComponent('notes/report.md')}&workspacePath=${encodeURIComponent(workspace)}&kind=text`);
  await assertOk(response);
  const textDerivative = await response.json() as { derivative: { kind: string; status: string; ref: string; mimeType: string } };
  assert.equal(textDerivative.derivative.kind, 'text');
  assert.equal(textDerivative.derivative.status, 'available');
  assert.equal(textDerivative.derivative.mimeType, 'text/plain');

  response = await fetch(`${baseUrl}/api/sciforge/preview/descriptor?ref=${encodeURIComponent('../outside.md')}&workspacePath=${encodeURIComponent(workspace)}`);
  assert.equal(response.status, 400);

  response = await fetch(`${baseUrl}/api/sciforge/workspace/file?path=${encodeURIComponent(imagePath)}`);
  await assertOk(response);
  const image = await response.json() as { file: { name: string; content: string; language: string; encoding?: string; mimeType?: string } };
  assert.equal(image.file.name, 'pixel.png');
  assert.equal(image.file.language, 'image');
  assert.equal(image.file.encoding, 'base64');
  assert.equal(image.file.mimeType, 'image/png');
  assert.equal(image.file.content, 'iVBORw0KGgo=');

  response = await fetch(`${baseUrl}/api/sciforge/preview/descriptor?ref=${encodeURIComponent(imagePath)}`);
  await assertOk(response);
  const imageDescriptor = await response.json() as { descriptor: { kind: string; inlinePolicy: string; derivatives: Array<{ kind: string; status: string }>; actions: string[] } };
  assert.equal(imageDescriptor.descriptor.kind, 'image');
  assert.equal(imageDescriptor.descriptor.inlinePolicy, 'stream');
  assert.ok(imageDescriptor.descriptor.derivatives.some((item) => item.kind === 'thumb' && item.status === 'lazy'));
  assert.ok(imageDescriptor.descriptor.actions.includes('select-region'));

  response = await fetch(`${baseUrl}/api/sciforge/preview/derivative?ref=${encodeURIComponent(imagePath)}&kind=thumb`);
  await assertOk(response);
  const thumbDerivative = await response.json() as { derivative: { kind: string; status: string; mimeType: string } };
  assert.equal(thumbDerivative.derivative.kind, 'thumb');
  assert.equal(thumbDerivative.derivative.status, 'available');
  assert.equal(thumbDerivative.derivative.mimeType, 'image/png');

  response = await fetch(`${baseUrl}/api/sciforge/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, path: filePath, content: '# Draft\n\nhello world' }),
  });
  await assertOk(response);
  assert.equal(await readFile(filePath, 'utf8'), '# Draft\n\nhello world');

  const outsideAbsoluteWritePath = join(outsideDir, 'absolute-escape.md');
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, path: outsideAbsoluteWritePath, content: 'outside' }),
  });
  assert.equal(response.status, 400);
  assert.equal(await readOptionalText(outsideAbsoluteWritePath), undefined);

  const outsideRelativeWritePath = join(outsideDir, 'relative-escape.md');
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, path: `../${basename(outsideDir)}/relative-escape.md`, content: 'outside' }),
  });
  assert.equal(response.status, 400);
  assert.equal(await readOptionalText(outsideRelativeWritePath), undefined);

  const renamedPath = join(workspace, 'notes', 'renamed.md');
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, action: 'rename', path: filePath, targetPath: renamedPath }),
  });
  await assertOk(response);
  assert.equal(await readFile(renamedPath, 'utf8'), '# Draft\n\nhello world');

  const safeRenameSourcePath = join(workspace, 'notes', 'safe-rename.md');
  const outsideRenamePath = join(outsideDir, 'renamed-outside.md');
  await writeFile(safeRenameSourcePath, 'stay inside', 'utf8');
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, action: 'rename', path: safeRenameSourcePath, targetPath: outsideRenamePath }),
  });
  assert.equal(response.status, 400);
  assert.equal(await readFile(safeRenameSourcePath, 'utf8'), 'stay inside');
  assert.equal(await readOptionalText(outsideRenamePath), undefined);

  const protectedOutsidePath = join(outsideDir, 'protected.md');
  await writeFile(protectedOutsidePath, 'protected', 'utf8');
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, action: 'delete', path: protectedOutsidePath }),
  });
  assert.equal(response.status, 400);
  assert.equal(await readFile(protectedOutsidePath, 'utf8'), 'protected');

  response = await fetch(`${baseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, action: 'delete', path: renamedPath }),
  });
  await assertOk(response);
  response = await fetch(`${baseUrl}/api/sciforge/workspace/file?path=${encodeURIComponent(renamedPath)}`);
  assert.equal(response.status, 400);

  const sessionBundleRoot = join(workspace, '.sciforge', 'sessions', '2026-05-16_omics_session-omics-complete');
  await mkdir(join(sessionBundleRoot, 'records'), { recursive: true });
  await mkdir(join(sessionBundleRoot, 'artifacts'), { recursive: true });
  const staleWorkspaceSession = {
    schemaVersion: 2,
    sessionId: 'session-omics-complete',
    scenarioId: 'omics-differential-exploration',
    title: 'omics',
    createdAt: '2026-05-16T01:00:00.000Z',
    updatedAt: '2026-05-16T01:00:00.000Z',
    messages: [],
    runs: [],
    artifacts: [],
    executionUnits: [],
  };
  const completeBundleSession = {
    ...staleWorkspaceSession,
    updatedAt: '2026-05-16T01:05:00.000Z',
    messages: [{ id: 'msg-1', role: 'user', content: 'analyze data', createdAt: '2026-05-16T01:01:00.000Z', status: 'completed' }],
    runs: [{ id: 'run-1', scenarioId: 'omics-differential-exploration', status: 'completed', prompt: 'analyze data', response: 'done', createdAt: '2026-05-16T01:01:00.000Z' }],
    artifacts: [],
    executionUnits: [{ id: 'eu-1', tool: 'analysis', status: 'done', createdAt: '2026-05-16T01:01:00.000Z' }],
  };
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify({
    schemaVersion: 2,
    workspacePath: workspace,
    sessionsByScenario: {
      'omics-differential-exploration': staleWorkspaceSession,
    },
    archivedSessions: [],
    timelineEvents: [],
    updatedAt: '2026-05-16T01:00:00.000Z',
  }, null, 2));
  await writeFile(join(sessionBundleRoot, 'records', 'session.json'), JSON.stringify(completeBundleSession, null, 2));
  await writeFile(join(sessionBundleRoot, 'artifacts', 'research-report-analysis-report.json'), JSON.stringify({
    id: 'analysis-report',
    type: 'research-report',
    title: 'Analysis Report',
    path: join(sessionBundleRoot, 'task-results', 'analysis_report.md'),
    dataRef: join(sessionBundleRoot, 'task-results', 'analysis_report.md'),
    producerScenario: 'omics-differential-exploration',
    schemaVersion: '1',
  }, null, 2));
  response = await fetch(`${baseUrl}/api/sciforge/workspace/snapshot?path=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const restoredSnapshot = await response.json() as { state: { sessionsByScenario: Record<string, { runs: unknown[]; artifacts: Array<{ delivery?: { role?: string; previewPolicy?: string } }>; executionUnits: unknown[] }> } };
  const restoredSession = restoredSnapshot.state.sessionsByScenario['omics-differential-exploration'];
  assert.equal(restoredSession.runs.length, 1);
  assert.equal(restoredSession.artifacts.length, 1);
  assert.equal(restoredSession.artifacts[0]?.delivery?.role, 'primary-deliverable');
  assert.equal(restoredSession.artifacts[0]?.delivery?.previewPolicy, 'inline');
  assert.equal(restoredSession.executionUnits.length, 1);

  console.log('[ok] workspace file APIs and preview contract cover list/read/write/raw-range/descriptor/derivative/delete/snapshot-bundle-reconcile');
} finally {
  child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
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

async function readOptionalText(path: string) {
  return await readFile(path, 'utf8').catch(() => undefined);
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Buffer.concat(chunks).toString('utf8');
}
