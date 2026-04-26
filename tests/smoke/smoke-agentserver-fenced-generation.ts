import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-fenced-generation-'));
await mkdir(join(workspace, '.bioagent', 'tasks'), { recursive: true });
await writeFile(join(workspace, '.bioagent', 'tasks', 'fenced_generation.py'), [
  'import json, sys',
  'json.dump({"message":"ok","confidence":0.8,"claimType":"evidence-summary","evidenceLevel":"mock","reasoningTrace":"generated task ran","claims":[],"uiManifest":[],"executionUnits":[{"id":"eu-fenced","tool":"generated.python","status":"done"}],"artifacts":[]}, open(sys.argv[2], "w"))',
].join('\n'));

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-fenced-generation-run',
        status: 'completed',
        output: {
          success: true,
          result: [
            '```json',
            JSON.stringify({
              taskFiles: ['.bioagent/tasks/fenced_generation.py'],
              entrypoint: '.bioagent/tasks/fenced_generation.py',
              expectedArtifacts: [],
            }),
            '```',
          ].join('\n'),
        },
      },
    },
  }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: '生成并运行一个最小任务',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.equal(result.message, 'ok');
  assert.ok(result.reasoningTrace.includes('generated task ran'));
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'generated.python'));
  assert.ok(!result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.direct-text'));
  console.log('[ok] fenced AgentServer task generation is parsed, written, and executed');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
