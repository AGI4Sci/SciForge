import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-path-only-'));
await mkdir(join(workspace, '.sciforge', 'tasks'), { recursive: true });
await writeFile(join(workspace, '.sciforge', 'tasks', 'path_only.py'), [
  'import json, sys',
  'with open(sys.argv[1], "r", encoding="utf-8") as handle:',
  '    request = json.load(handle)',
  'payload = {',
  '    "message": "path-only task ran",',
  '    "confidence": 0.81,',
  '    "claimType": "evidence-summary",',
  '    "evidenceLevel": "mock-agentserver",',
  '    "reasoningTrace": "read existing workspace edit for " + request.get("prompt", ""),',
  '    "claims": [],',
  '    "uiManifest": [{"componentId": "report-viewer", "artifactRef": "path-only-report"}],',
  '    "executionUnits": [{"id": "path-only-eu", "status": "done", "tool": "agentserver.path-only"}],',
  '    "artifacts": [{"id": "path-only-report", "type": "research-report", "data": {"markdown": "existing workspace task executed"}}]',
  '}',
  'with open(sys.argv[2], "w", encoding="utf-8") as handle:',
  '    json.dump(payload, handle)',
].join('\n'));

await appendTaskAttempt(workspace, {
  id: 'prior-path-only-attempt',
  prompt: 'prior failed path-only run',
  skillDomain: 'literature',
  skillId: 'agentserver.generate.literature',
  attempt: 1,
  status: 'repair-needed',
  failureReason: 'prior task needed workspace file reuse',
  createdAt: '2026-04-26T00:00:00.000Z',
});

let capturedBody: Record<string, unknown> | undefined;

const server = createServer(async (req, res) => {
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  capturedBody = JSON.parse(await readBody(req));
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-path-only-run',
        status: 'completed',
        output: {
          taskFiles: [{ path: '.sciforge/tasks/path_only.py', language: 'python' }],
          entrypoint: { language: 'python', path: '.sciforge/tasks/path_only.py' },
          expectedArtifacts: ['research-report'],
          patchSummary: 'AgentServer wrote the task directly in the workspace and returned a path-only reference.',
        },
      },
    },
  };
  if (req.url === '/api/agent-server/runs/stream') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ result }) + '\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'path-only AgentServer workspace edit should be executed',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    modelProvider: 'openai-compatible',
    modelName: 'mock-model',
    llmEndpoint: {
      provider: 'openai-compatible',
      baseUrl: 'http://llm.example.test/v1',
      apiKey: 'path-only-secret-key',
      modelName: 'mock-model',
    },
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer', 'execution-unit-table'],
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.equal(result.message, 'path-only task ran');
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.path-only'));
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'research-report'));

  assert.ok(capturedBody);
  const agent = isRecord(capturedBody.agent) ? capturedBody.agent : {};
  const input = isRecord(capturedBody.input) ? capturedBody.input : {};
  const runtime = isRecord(capturedBody.runtime) ? capturedBody.runtime : {};
  const promptText = typeof input.text === 'string' ? input.text : '';
  assert.equal(agent.workspace, workspace);
  assert.equal(agent.workingDirectory, workspace);
  assert.equal(agent.backend, runtime.backend);
  assert.match(promptText, /path-only AgentServer workspace edit/);
  assert.match(promptText, /research-report/);
  assert.match(promptText, /report-viewer/);

  const taskArchives = await collectTaskArchives(join(workspace, '.sciforge'));
  assert.ok(taskArchives.some((entry) => entry.includes('/tasks/generated-literature-') || entry.startsWith('tasks/generated-literature-')));
  const debugFiles = await readdir(join(workspace, '.sciforge', 'debug', 'agentserver'));
  assert.equal(debugFiles.length, 1);
  const debug = await readFile(join(workspace, '.sciforge', 'debug', 'agentserver', debugFiles[0]), 'utf8');
  assert.doesNotMatch(debug, /path-only-secret-key/);
  assert.match(debug, /\[redacted\]/);
  console.log('[ok] path-only AgentServer taskFiles reuse workspace edits and write redacted debug artifact');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function collectTaskArchives(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      out.push(relative(root, full).replaceAll('\\', '/'));
    }
  }
  await visit(root);
  return out;
}

function readBody(req: AsyncIterable<Buffer | string>) {
  return new Promise<string>(async (resolve) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolve(Buffer.concat(chunks).toString('utf8'));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
