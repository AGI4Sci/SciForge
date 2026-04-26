import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-direct-text-'));

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
        id: 'mock-agentserver-direct-text-run',
        status: 'completed',
        output: {
          success: true,
          result: [
            '# Agent paper report',
            '',
            'AgentServer completed the reading task but returned plain text instead of taskFiles.',
            'BioAgent should preserve this as a research-report artifact for the user.',
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

  const report = result.artifacts.find((artifact) => artifact.type === 'research-report');
  assert.ok(report);
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'report-viewer'));
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.direct-text'));
  assert.match(result.reasoningTrace, /direct ToolPayload|plain text|AgentServer returned plain text/i);
  console.log('[ok] AgentServer plain-text output is bridged into a research-report ToolPayload');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
