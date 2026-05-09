import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-stream-text-generation-'));
const taskCode = String.raw`
import json
import sys

payload = {
  "message": "stream text task executed",
  "confidence": 0.8,
  "claimType": "fact",
  "evidenceLevel": "runtime",
  "reasoningTrace": "AgentServer text-delta JSON was parsed.",
  "claims": [],
  "uiManifest": [],
  "executionUnits": [{"id": "EU-stream-text", "tool": "agentserver.stream-text", "status": "done"}],
  "artifacts": [{"id": "stream-report", "type": "research-report", "data": {"markdown": "ok"}}]
}
with open(sys.argv[2], "w", encoding="utf-8") as handle:
  json.dump(payload, handle)
`;

const generationJson = JSON.stringify({
  taskFiles: [{ path: 'tasks/stream-text-task.py', language: 'python', content: taskCode }],
  entrypoint: { path: 'tasks/stream-text-task.py', language: 'python' },
  expectedArtifacts: ['research-report'],
  patchSummary: 'stream text generation',
});

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.write(JSON.stringify({ type: 'status', status: 'running', message: 'AgentServer is searching and writing task code.' }) + '\n');
  res.write(JSON.stringify({ type: 'text_delta', delta: generationJson }) + '\n');
  res.end(JSON.stringify({
    result: {
      ok: true,
      data: {
        run: {
          id: 'mock-stream-text-run',
          status: 'completed',
          output: { success: true, result: generationJson.slice(0, 80) + '...[truncated]' },
        },
      },
    },
  }) + '\n');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

try {
  const events: Array<{ type: string; detail?: string }> = [];
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Generate from streamed AgentServer text when HTTP result is truncated.',
    workspacePath: workspace,
    agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
    expectedArtifactTypes: ['research-report'],
    artifacts: [],
  }, {
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.executionUnits[0]?.status, 'done');
  assert.ok(result.artifacts.some((artifact) => artifact.id === 'stream-report'));
  assert.ok(events.some((event) => event.type === 'status' && String(event.detail || '').includes('searching and writing')));
  assert.ok(events.some((event) => event.type === 'text-delta'));
  console.log('[ok] AgentServer streamed generation JSON is parsed when HTTP result is truncated');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
