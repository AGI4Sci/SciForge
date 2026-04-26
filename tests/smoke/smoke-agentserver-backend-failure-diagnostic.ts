import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-backend-failure-'));

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
        id: 'mock-agentserver-failed-run',
        status: 'failed',
        output: {
          success: false,
          error: JSON.stringify({
            error: {
              message: 'unexpected status 401 Unauthorized: Invalid token (request id: secret-123), url: http://localhost:8767/codex/v1/responses',
            },
          }),
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
    prompt: '帮我搜索arxiv上最新的agent论文，阅读并总结成报告',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['paper-list', 'research-report'],
    selectedComponentIds: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
    uiState: {
      freshTaskGeneration: true,
      forceAgentServerGeneration: true,
      expectedArtifactTypes: ['paper-list', 'research-report'],
      selectedComponentIds: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
    },
    artifacts: [],
  });

  assert.match(result.message, /AgentServer backend failed/i);
  assert.match(result.message, /401 Unauthorized|Invalid token/i);
  assert.doesNotMatch(result.message, /taskFiles and entrypoint/i);
  assert.doesNotMatch(result.message, /secret-123|localhost:8767/i);
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.status === 'repair-needed'));
  console.log('[ok] AgentServer backend failures surface as actionable diagnostics, not protocol-shape errors');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
