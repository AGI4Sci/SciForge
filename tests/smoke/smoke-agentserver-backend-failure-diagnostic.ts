import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const AGENT_BACKENDS = ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'] as const;
type AgentBackend = typeof AGENT_BACKENDS[number];

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-backend-failure-'));
await mkdir(join(workspace, '.sciforge', 'tasks'), { recursive: true });
await writeFile(join(workspace, '.sciforge', 'tasks', 'stale.py'), [
  'import json, sys',
  'json.dump({"message":"stale task should not run","confidence":0.1,"claimType":"debug","evidenceLevel":"stale","reasoningTrace":"stale","claims":[],"uiManifest":[],"executionUnits":[],"artifacts":[]}, open(sys.argv[2], "w"))',
].join('\n'));

const server = createServer(async (req, res) => {
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const result = {
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
  assert.doesNotMatch(result.message, /stale task should not run/i);
  assert.doesNotMatch(result.message, /taskFiles and entrypoint/i);
  assert.doesNotMatch(result.message, /secret-123|localhost:8767/i);
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.status === 'repair-needed'));
  const diagnosticArtifact = result.artifacts.find((artifact) => isRecord(artifact) && artifact.id === 'literature-runtime-result');
  assert.ok(isRecord(diagnosticArtifact), 'backend failure must expose a structured runtime diagnostic artifact for the result panel');
  assert.equal(diagnosticArtifact.type, 'runtime-diagnostic');
  assert.ok(result.uiManifest.some((slot) => isRecord(slot) && slot.artifactRef === 'literature-runtime-result'));
  assert.match(JSON.stringify(diagnosticArtifact.data), /401 Unauthorized|Invalid token/i);
console.log('[ok] AgentServer backend failures surface as actionable diagnostics, not protocol-shape errors');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const rateLimitWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-rate-limit-'));
let rateLimitRuns = 0;
const hermesRateLimitResetAt = '2026-05-02T03:00:00.000Z';
const rateLimitServer = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        hermes: {
          context_compressor: {
            context_length: 10_000,
            max_context_length: 200_000,
            compression_threshold: 0.82,
            status: 'healthy',
          },
          rate_limit: {
            limited: true,
            rate_limit_reset_at: hermesRateLimitResetAt,
          },
        },
      },
    }));
    return;
  }
  if (req.method === 'POST' && String(req.url).includes('/compact')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        message: 'compacted for retry',
        context_compressor: {
          context_length: 3000,
          max_context_length: 200000,
          compression_threshold: 0.82,
          status: 'healthy',
          last_compressed_at: '2026-05-02T02:59:00.000Z',
        },
      },
    }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  rateLimitRuns += 1;
  res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0', 'X-RateLimit-Reset': hermesRateLimitResetAt });
  res.end(JSON.stringify({
    error: `responseTooManyFailedAttempts: exceeded retry limit after provider 429 Too Many Requests; retry-after 0; rate_limit_reset ${hermesRateLimitResetAt}`,
  }));
});

await new Promise<void>((resolve) => rateLimitServer.listen(0, '127.0.0.1', resolve));
const rateLimitAddress = rateLimitServer.address();
assert.ok(rateLimitAddress && typeof rateLimitAddress === 'object');
try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'knowledge',
    agentBackend: 'hermes-agent',
    prompt: '构建一个知识图谱并返回 network graph',
    workspacePath: rateLimitWorkspace,
    agentServerBaseUrl: `http://127.0.0.1:${rateLimitAddress.port}`,
    expectedArtifactTypes: ['knowledge-graph'],
    uiState: {
      sessionId: 'rate-limit-session',
      forceAgentServerGeneration: true,
      recentConversation: ['user: prior context '.repeat(2000), 'assistant: prior answer '.repeat(2000)],
      recentExecutionRefs: [{ id: 'old-run', outputRef: '.sciforge/task-results/old.json', stderrRef: '.sciforge/logs/old.err' }],
    },
    artifacts: [{ id: 'big-artifact', type: 'knowledge-graph', dataRef: '.sciforge/artifacts/big.json', data: { rows: Array.from({ length: 1000 }, (_, index) => ({ index, value: 'x'.repeat(200) })) } }],
  });

  assert.equal(rateLimitRuns, 2, '429 recovery must make at most one compact retry');
  assert.match(result.message, /rate-limit|retry budget|429|Too Many Requests/i);
  assert.match(result.message, new RegExp(hermesRateLimitResetAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Hermes rate-limit reset should be surfaced in final diagnostics');
  const unit = result.executionUnits.find((entry) => isRecord(entry) && entry.status === 'repair-needed') as Record<string, unknown> | undefined;
  assert.ok(unit, 'final 429 failure should surface a repair-needed execution unit');
  assert.ok((unit.recoverActions as string[] | undefined)?.some((action) => /rate-limit|retry budget|reset|quota/i.test(action)), 'final 429 failure should include user-visible recoverActions');
} finally {
  await new Promise<void>((resolve) => rateLimitServer.close(() => resolve()));
}

const slimWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-rate-limit-slim-'));
const slimBodies: unknown[] = [];
const slimServer = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/context')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'context snapshot unavailable' }));
    return;
  }
  if (req.method === 'POST' && String(req.url).includes('/compact')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { message: 'compacted before retry', contextWindow: { tokens: 2000, limit: 200000, ratio: 0.01 } } }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  slimBodies.push(body);
  if (slimBodies.length === 1) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
    res.end(JSON.stringify({ error: '429 Too Many Requests: retry budget exhausted; retry-after 0' }));
    return;
  }
  const payload = {
    message: 'Recovered after compact retry.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'agentserver-direct',
    reasoningTrace: 'mock retry success',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'retry-success', status: 'done', tool: 'mock' }],
    artifacts: [],
  };
  const result = { ok: true, data: { run: { id: 'retry-success-run', status: 'completed', output: { payload } } } };
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.end(JSON.stringify({ result }) + '\n');
});

await new Promise<void>((resolve) => slimServer.listen(0, '127.0.0.1', resolve));
const slimAddress = slimServer.address();
assert.ok(slimAddress && typeof slimAddress === 'object');
try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'knowledge',
    prompt: '基于上一轮结果继续生成知识图谱',
    workspacePath: slimWorkspace,
    agentServerBaseUrl: `http://127.0.0.1:${slimAddress.port}`,
    expectedArtifactTypes: ['knowledge-graph'],
    uiState: {
      sessionId: 'slim-retry-session',
      harnessProfileId: 'balanced-default',
      agentHarnessInput: {
        intentMode: 'continuation',
      },
      forceAgentServerGeneration: true,
      currentPrompt: '基于上一轮结果继续生成知识图谱',
      recentConversation: ['user: 请分析 '.repeat(5000), 'assistant: 已生成中间结果 '.repeat(5000)],
      recentRuns: Array.from({ length: 20 }, (_, index) => ({ id: `run-${index}`, output: 'large-output '.repeat(1000) })),
      recentExecutionRefs: [{ id: 'previous-run', outputRef: '.sciforge/task-results/previous.json', stderrRef: '.sciforge/logs/previous.err' }],
    },
    artifacts: Array.from({ length: 8 }, (_, index) => ({
      id: `artifact-${index}`,
      type: 'knowledge-graph',
      dataRef: `.sciforge/artifacts/artifact-${index}.json`,
      data: { rows: Array.from({ length: 300 }, (_, row) => ({ row, text: 'large-cell '.repeat(100) })) },
    })),
  });

  assert.equal(slimBodies.length, 2, 'successful 429 recovery should stop after the retry succeeds');
  assert.match(result.message, /Recovered after compact retry/);
  const firstBody = JSON.stringify(slimBodies[0]);
  const secondBody = JSON.stringify(slimBodies[1]);
  const firstInputText = isRecord(slimBodies[0]) && isRecord(slimBodies[0].input) ? String(slimBodies[0].input.text || '') : '';
  const secondInputText = isRecord(slimBodies[1]) && isRecord(slimBodies[1].input) ? String(slimBodies[1].input.text || '') : '';
  const secondContextMode = isRecord(slimBodies[1]) && isRecord(slimBodies[1].input) && isRecord(slimBodies[1].input.metadata)
    ? String(slimBodies[1].input.metadata.contextMode || '')
    : '';
  assert.ok(secondInputText.length < firstInputText.length, `retry prompt/context should be slimmer: first=${firstInputText.length} second=${secondInputText.length}`);
  assert.equal(secondContextMode, 'delta', 'retry handoff should force delta/slim context mode');
  assert.match(secondBody, /sciforge\.agentserver-generation-retry\.v1/);
  assert.match(secondBody, /backendRetryAudit|retryAudit/);
  const retryAudit = isRecord(slimBodies[1]) && isRecord(slimBodies[1].input) && isRecord(slimBodies[1].input.metadata)
    ? slimBodies[1].input.metadata.retryAudit
    : undefined;
  assert.ok(isRecord(retryAudit), 'retry dispatch should carry structured retryAudit metadata');
  const retryHarnessSignals = isRecord(retryAudit) && isRecord(retryAudit.harnessSignals) ? retryAudit.harnessSignals : {};
  assert.equal(retryHarnessSignals.harnessStage, 'onPolicyDecision');
  const retryExternalHook = isRecord(retryHarnessSignals.externalHook) ? retryHarnessSignals.externalHook : {};
  assert.equal(retryExternalHook.schemaVersion, 'sciforge.agent-harness-external-hook-trace.v1');
  assert.equal(retryExternalHook.stage, 'onPolicyDecision');
  assert.equal(retryExternalHook.stageGroup, 'external-hook');
  assert.equal(retryExternalHook.declaredBy, 'HARNESS_EXTERNAL_HOOK_STAGES');
  assert.equal(retryExternalHook.declared, true);
} finally {
  await new Promise<void>((resolve) => slimServer.close(() => resolve()));
}

const rateLimitMatrixRunsByBackend = new Map<AgentBackend, number>();
const rateLimitMatrixCompactsByBackend = new Map<AgentBackend, number>();
let activeRateLimitMatrixBackend: AgentBackend = 'codex';
const rateLimitMatrixResetAt = '2026-05-02T04:00:00.000Z';
const rateLimitMatrixServer = createServer(async (req, res) => {
  const url = String(req.url || '');
  if (req.method === 'GET' && url.includes('/context')) {
    const backend = activeRateLimitMatrixBackend;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: backend === 'hermes-agent'
        ? {
          hermes: {
            context_compressor: {
              context_length: 12_000,
              max_context_length: 200_000,
              compression_threshold: 0.82,
              status: 'healthy',
            },
            rate_limit: {
              limited: true,
              rate_limit_reset_at: rateLimitMatrixResetAt,
            },
          },
        }
        : {
          contextWindow: {
            tokens: 12_000,
            limit: 200_000,
            ratio: 0.06,
            status: 'healthy',
          },
          workBudget: { status: 'healthy', approxCurrentWorkTokens: 12_000 },
        },
    }));
    return;
  }
  if (req.method === 'POST' && url.includes('/compact')) {
    const backend = activeRateLimitMatrixBackend;
    rateLimitMatrixCompactsByBackend.set(backend, (rateLimitMatrixCompactsByBackend.get(backend) ?? 0) + 1);
    if (backend === 'openclaw') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'compact unsupported for openclaw compatibility backend' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        message: `compacted before ${backend} 429 retry`,
        contextWindow: { tokens: 6000, limit: 200000, ratio: 0.03, status: 'healthy' },
      },
    }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(url) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const agent = isRecord(body.agent) ? body.agent : {};
  const backend = String(agent.backend || '');
  assert.ok(isAgentBackend(backend), `unexpected backend ${backend}`);
  rateLimitMatrixRunsByBackend.set(backend, (rateLimitMatrixRunsByBackend.get(backend) ?? 0) + 1);
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': '0',
    'X-RateLimit-Reset': rateLimitMatrixResetAt,
  });
  res.end(JSON.stringify({
    error: `${backend} responseTooManyFailedAttempts: provider 429 Too Many Requests; retry-after 0; rate_limit_reset ${rateLimitMatrixResetAt}`,
  }));
});

await new Promise<void>((resolve) => rateLimitMatrixServer.listen(0, '127.0.0.1', resolve));
const rateLimitMatrixAddress = rateLimitMatrixServer.address();
assert.ok(rateLimitMatrixAddress && typeof rateLimitMatrixAddress === 'object');
try {
  for (const backend of AGENT_BACKENDS) {
    activeRateLimitMatrixBackend = backend;
    const matrixWorkspace = await mkdtemp(join(tmpdir(), `sciforge-agentserver-${backend}-rate-limit-matrix-`));
    const result = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      agentBackend: backend,
      prompt: `T057 ${backend} 429 retry-budget matrix failure`,
      workspacePath: matrixWorkspace,
      agentServerBaseUrl: `http://127.0.0.1:${rateLimitMatrixAddress.port}`,
      expectedArtifactTypes: ['knowledge-graph'],
      uiState: {
        sessionId: `rate-limit-matrix-${backend}`,
        forceAgentServerGeneration: true,
        recentConversation: ['user: prior matrix context '.repeat(800), 'assistant: prior matrix answer '.repeat(800)],
        recentExecutionRefs: [{ id: 'previous-run', outputRef: '.sciforge/task-results/previous.json' }],
      },
      artifacts: [{ id: 'previous-graph', type: 'knowledge-graph', dataRef: '.sciforge/artifacts/previous-graph.json' }],
    });

    assert.equal(rateLimitMatrixRunsByBackend.get(backend), 2, `${backend} 429 recovery must stop after one compact retry`);
    assert.ok((rateLimitMatrixCompactsByBackend.get(backend) ?? 0) >= 1, `${backend} 429 recovery should attempt compact or explicit fallback before retry`);
    assert.match(result.message, /429|Too Many Requests|rate-limit|retry budget/i);
    const unit = result.executionUnits.find((entry) => isRecord(entry) && entry.status === 'repair-needed') as Record<string, unknown> | undefined;
    assert.ok(unit, `${backend} final 429 failure should surface a repair-needed execution unit`);
    assert.ok((unit.recoverActions as string[] | undefined)?.some((action) => /rate-limit|retry budget|reset|quota/i.test(action)), `${backend} final 429 failure should include recoverActions`);
    const refs = isRecord(unit.refs) ? unit.refs : {};
    assert.equal(refs.backend, backend);
    assert.ok(typeof refs.provider === 'string' && refs.provider.length > 0, `${backend} final 429 failure should include provider ref`);
    assert.match(String(refs.sessionRef || ''), /\/api\/agent-server\/agents\/sciforge-knowledge-/);
    assert.equal(refs.retryAttempted, true);
    assert.equal(refs.retrySucceeded, false);
    if (backend === 'hermes-agent') {
      assert.match(String(unit.failureReason || result.message), new RegExp(rateLimitMatrixResetAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Hermes rate-limit reset should stay visible in matrix diagnostics');
    }
  }
} finally {
  await new Promise<void>((resolve) => rateLimitMatrixServer.close(() => resolve()));
}

console.log('[ok] AgentServer 429/retry-budget failures retry once with compact handoff audit and surface recoverActions on final failure for every backend');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(req: AsyncIterable<Buffer | string>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function isAgentBackend(value: string): value is AgentBackend {
  return AGENT_BACKENDS.includes(value as AgentBackend);
}
