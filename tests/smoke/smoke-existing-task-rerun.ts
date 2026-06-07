import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-existing-task-rerun-'));
const taskRel = '.sciforge/tasks/existing-rerun/run.py';
const taskCode = [
  'import argparse, json, os',
  'parser = argparse.ArgumentParser()',
  'parser.add_argument("--inputPath", required=False)',
  'parser.add_argument("--outputPath", required=True)',
  'args = parser.parse_args()',
  'payload = {',
  '    "message": "existing task rerun completed",',
  '    "confidence": 0.9,',
  '    "claimType": "evidence-synthesis",',
  '    "evidenceLevel": "runtime",',
  '    "reasoningTrace": "Reran an existing workspace task instead of starting new backend generation.",',
  '    "claims": [],',
  '    "uiManifest": [{"componentId": "paper-card-list", "artifactRef": "paper-list"}],',
  '    "executionUnits": [{"id": "existing-rerun", "status": "done", "tool": "workspace.existing-rerun"}],',
  '    "artifacts": [{"id": "paper-list", "type": "paper-list", "data": {"papers": [{"title": "paper A"}]}}]',
  '}',
  'os.makedirs(os.path.dirname(args.outputPath), exist_ok=True)',
  'with open(args.outputPath, "w", encoding="utf-8") as handle:',
  '    json.dump(payload, handle, indent=2)',
].join('\n');

await mkdir(dirname(join(workspace, taskRel)), { recursive: true });
await writeFile(join(workspace, taskRel), taskCode, 'utf8');

let requestBody = '';
const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  requestBody = await readBody(req);
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-existing-rerun-generation',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: taskRel, language: 'python' }],
            entrypoint: { language: 'python', path: taskRel },
            environmentRequirements: { language: 'python' },
            validationCommand: `python3 ${taskRel} --outputPath .sciforge/task-results/existing-rerun.json`,
            expectedArtifacts: ['paper-list'],
            patchSummary: 'Backend chose to rerun the existing workspace task path.',
          },
        },
      },
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.end(JSON.stringify({ result }) + '\n');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: `Round 2：请重新执行上一轮已经写出的脚本 ${taskRel}，生成并落盘 paper-list artifacts。`,
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['paper-list'],
    artifacts: [],
  });

  assert.match(requestBody, /agent backend decision-maker/);
  assert.equal(result.message, 'existing task rerun completed');
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.agentServerGenerated === true));
  console.log('[ok] explicit multi-turn existing task rerun is delegated to AgentServer and executed');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
