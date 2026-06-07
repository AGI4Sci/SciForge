import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { requestBackendGeneration, requestUsesRepairContext } from './backend-generation-dispatch.js';

function testSkill(): SkillAvailability {
  return {
    id: 'literature-test',
    kind: 'package',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-17T00:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {
      id: 'literature-test',
      kind: 'package',
      description: 'test',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'backend-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

test('fresh repair-or-continue execution mode does not imply repair continuation without a repair target', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请用最小检索验证 arXiv 记录并输出证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'fresh-literature-evidence-review',
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'new-task' },
        contextPolicy: { mode: 'isolate' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['research', 'artifact-output', 'long-or-uncertain'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('repair context requires a concrete failed run or execution ref', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '修复上一轮失败并继续。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-without-target',
      contextReusePolicy: { mode: 'repair', historyReuse: { allowed: true } },
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('stale failed execution refs do not authorize repair from policy keywords alone', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请复用失败诊断继续，修正生成任务并完成中文证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-keywords-with-stale-target',
      recentExecutionRefs: [{
        id: 'EU-stale-failed',
        status: 'failed-with-reason',
        stderrRef: '.sciforge/task-results/stale.stderr.txt',
        outputRef: '.sciforge/task-results/stale.json',
        failureReason: 'stale failure from an older projection',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), false);
});

test('failed current projection refs still authorize repair continuation', () => {
  const request = {
    skillDomain: 'literature',
    prompt: '请复用失败诊断继续，修正生成任务并完成中文证据摘要。',
    artifacts: [],
    uiState: {
      sessionId: 'repair-with-target',
      contextReusePolicy: {
        mode: 'repair',
        historyReuse: { allowed: true },
        priorWorkSignals: { repairTargetAvailable: true },
      },
      recentExecutionRefs: [{
        id: 'EU-failed',
        status: 'failed-with-reason',
        stderrRef: '.sciforge/task-results/failed.stderr.txt',
        outputRef: '.sciforge/task-results/failed.json',
        failureReason: 'prior bounded stop',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'repair' },
        executionModePlan: {
          executionMode: 'repair-or-continue-project',
          signals: ['repair'],
        },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), true);
});

test('structured recover action reference authorizes repair continuation without policy text signals', () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'continue from the available action',
    artifacts: [],
    references: [{
      ref: 'recover-action:retry-provider',
      kind: 'recover-action',
      source: 'recover-action',
    }],
    uiState: {
      sessionId: 'repair-with-recover-action',
      recentExecutionRefs: [{
        id: 'EU-failed',
        status: 'repair-needed',
        outputRef: '.sciforge/task-results/failed.json',
        failureReason: 'schema validation failed',
      }],
      conversationPolicy: {
        goalSnapshot: { taskRelation: 'continue' },
      },
    },
  } as GatewayRequest;

  assert.equal(requestUsesRepairContext(request), true);
});

test('backend generation retries once with capability discovery tool results for backend consumption', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-discovery-consume-'));
  const requestBodies: string[] = [];
  let runCount = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'discovery-consume', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    runCount += 1;
    const body = await readBody(req);
    requestBodies.push(body);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (runCount === 1) {
      res.end(`${JSON.stringify({
        event: {
          type: 'tool-call',
          id: 'call-discovery-consume',
          toolName: 'capability_discovery.search',
          input: {
            goal: 'Need literature search and PDF full-text capability.',
            desiredArtifacts: ['research-report'],
            constraints: { maxCandidates: 2 },
          },
        },
      })}\n`);
      return;
    }
    assert.match(body, /capabilityDiscoveryToolResults/);
    assert.match(body, /capability_discovery\.search/);
    assert.match(body, /completionEvidence/);
    assert.match(body, /not-evidence/);
    const result = {
      ok: true,
      data: {
        run: {
          id: 'run-discovery-consumed',
          status: 'completed',
          output: {
            result: {
              message: 'Discovery result was consumed; execute selected work through invoke_capability.',
              confidence: 0.8,
              claimType: 'runtime-diagnostic',
              evidenceLevel: 'agentserver',
              claims: [],
              uiManifest: [],
              executionUnits: [{ id: 'EU-discovery-consumed', tool: 'agentserver.generation', status: 'done' }],
              artifacts: [],
            },
          },
        },
      },
    };
    res.end(`${JSON.stringify({ result })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const result = await requestBackendGeneration({
      baseUrl: `http://127.0.0.1:${address.port}`,
      request: {
        workspacePath: workspace,
        skillDomain: 'literature',
        prompt: 'Find the right literature capabilities before generating a task.',
        artifacts: [],
        uiState: { sessionId: 'session-discovery-consume' },
      } as GatewayRequest,
      skill: testSkill(),
      skills: [testSkill()],
      workspace,
    });

    assert.equal(runCount, 2, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal('directPayload' in result, true);
    if (result.ok && 'directPayload' in result) {
      assert.match(result.directPayload.message, /Discovery result was consumed/);
    }
    assert.doesNotMatch(requestBodies[0] ?? '', /capabilityDiscoveryToolResults/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('backend generation failure diagnostics include modified existing workspace files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-existing-file-side-effect-'));
  const sourceRel = 'weighted_survival_auc.py';
  await writeFile(join(workspace, sourceRel), 'pair_weight = censoring_weights[i] + censoring_weights[j]\n', 'utf8');

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'side-effect', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    await readBody(req);
    await writeFile(join(workspace, sourceRel), 'pair_weight = censoring_weights[i] * censoring_weights[j]\n', 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ event: { type: 'status', usage: { total: 999999 }, message: 'still generating' } })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const result = await requestBackendGeneration({
      baseUrl: `http://127.0.0.1:${address.port}`,
      request: {
        workspacePath: workspace,
        skillDomain: 'literature',
        prompt: 'Debug the current workspace code, patch the bug, and rerun tests.',
        artifacts: [],
        maxContextWindowTokens: 200000,
        uiState: { sessionId: 'session-existing-file-side-effect' },
      } as GatewayRequest,
      skill: testSkill(),
      skills: [testSkill()],
      workspace,
    });

    assert.equal(result.ok, false);
    assert.match(await readFile(join(workspace, sourceRel), 'utf8'), /\*/);
    if (!result.ok) {
      const sideEffects = result.diagnostics?.sideEffectWorkEvidence ?? [];
      assert.equal(sideEffects.some((entry) => (
        entry.kind === 'write'
        && entry.status === 'success'
        && entry.rawRef === sourceRel
        && (entry.input as Record<string, unknown> | undefined)?.sideEffect === 'modified-existing-file'
      )), true, JSON.stringify(sideEffects));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('malformed generation response diagnostics preserve workspace side effects', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-malformed-side-effect-'));
  const sourceRel = 'paper_metric_kernel.py';
  await writeFile(join(workspace, sourceRel), 'import fastmmd\nvalue = 1\n', 'utf8');

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'malformed-side-effect', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    await readBody(req);
    await writeFile(join(workspace, sourceRel), 'value = 2\n', 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({
      result: {
        ok: true,
        data: {
          run: {
            id: 'run-malformed-side-effect',
            status: 'completed',
            result: {
              finalText: '```json\n{ "kind": "AgentServerGenerationResponse", "taskFiles": [ { "path": "broken.py", "content": "unterminated',
            },
          },
        },
      },
    })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const result = await requestBackendGeneration({
      baseUrl: `http://127.0.0.1:${address.port}`,
      request: {
        workspacePath: workspace,
        skillDomain: 'literature',
        prompt: 'Debug the current workspace code, patch the bug, and rerun tests.',
        artifacts: [],
        maxContextWindowTokens: 200000,
        uiState: { sessionId: 'session-malformed-side-effect' },
      } as GatewayRequest,
      skill: testSkill(),
      skills: [testSkill()],
      workspace,
    });

    assert.equal(result.ok, false);
    assert.match(await readFile(join(workspace, sourceRel), 'utf8'), /value = 2/);
    if (!result.ok) {
      const sideEffects = result.diagnostics?.sideEffectWorkEvidence ?? [];
      assert.equal(sideEffects.some((entry) => (
        entry.kind === 'write'
        && entry.status === 'success'
        && entry.rawRef === sourceRel
        && (entry.input as Record<string, unknown> | undefined)?.sideEffect === 'modified-existing-file'
      )), true, JSON.stringify(sideEffects));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
