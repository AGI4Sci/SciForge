import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-fresh-prior-attempts-'));
await appendTaskAttempt(workspace, {
  id: 'stale-literature-failure',
  attempt: 1,
  prompt: '帮我检索最近一周arxiv上agent相关的论文，下载并阅读全文，然后写一份系统的总结报告',
  skillDomain: 'literature',
  createdAt: '2026-05-01T00:00:00.000Z',
  routeDecision: {
    selectedSkill: 'agentserver.generate.literature',
    fallbackReason: 'stale',
    selectedAt: '2026-05-01T00:00:00.000Z',
  },
  codeRef: '.sciforge/tasks/stale.py',
  outputRef: '.sciforge/task-results/stale.json',
  stdoutRef: '.sciforge/logs/stale.stdout.log',
  stderrRef: '.sciforge/logs/stale.stderr.log',
  exitCode: 1,
  status: 'failed-with-reason',
  failureReason: 'SHOULD_NOT_REACH_FRESH_AGENTSERVER_PROMPT',
  schemaErrors: [],
});

let capturedPrompt = '';
let capturedSerialized = '';
const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  capturedPrompt = String(body?.input?.text ?? '');
  capturedSerialized = JSON.stringify(body);
  const payload = {
    message: 'fresh request handled',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'fresh current-turn request avoided stale attempts',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'EU-fresh', tool: 'agentserver.mock', status: 'done' }],
    artifacts: [],
  };
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.end(JSON.stringify({
    result: {
      ok: true,
      data: {
        run: {
          id: 'mock-fresh-run',
          status: 'completed',
          output: { result: JSON.stringify(payload) },
        },
      },
    },
  }) + '\n');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

try {
  await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: '帮我检索最近一周arxiv上agent相关的论文，下载并阅读全文，然后写一份系统的总结报告',
    workspacePath: workspace,
    agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
    expectedArtifactTypes: ['paper-list', 'research-report'],
    artifacts: [],
  });
  assert.ok(capturedSerialized, 'AgentServer stream endpoint should receive a generation handoff');
  assert.doesNotMatch(capturedSerialized, /SHOULD_NOT_REACH_FRESH_AGENTSERVER_PROMPT/);
  assert.match(capturedPrompt || capturedSerialized, /FRESH GENERATION MODE|Fresh-generation hard rule|CURRENT TURN SNAPSHOT/);
  console.log('[ok] fresh AgentServer generation handoff avoids stale prior task attempts');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
