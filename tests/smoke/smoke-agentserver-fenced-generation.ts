import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-fenced-generation-'));
await mkdir(join(workspace, '.sciforge', 'tasks'), { recursive: true });
await writeFile(join(workspace, '.sciforge', 'tasks', 'fenced_generation.py'), [
  'import json, sys',
  'json.load(open(sys.argv[1], encoding="utf-8"))',
  'json.dump({"message":"ok","confidence":0.8,"claimType":"evidence-summary","evidenceLevel":"mock","reasoningTrace":"generated task ran","claims":[],"uiManifest":[],"executionUnits":[{"id":"eu-fenced","tool":"generated.python","status":"done"}],"artifacts":[]}, open(sys.argv[2], "w"))',
].join('\n'));

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-fenced-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 80 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const result = {
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
              taskFiles: [{ path: '.sciforge/tasks/fenced_generation.py', language: 'python' }],
              entrypoint: { language: 'python', path: '.sciforge/tasks/fenced_generation.py' },
              expectedArtifacts: [],
            }),
            '```',
          ].join('\n'),
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
