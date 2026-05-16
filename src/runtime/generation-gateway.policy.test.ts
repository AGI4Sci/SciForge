import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GATEWAY_PIPELINE_STAGE_ORDER,
  GATEWAY_PIPELINE_STAGES,
  STAGE_AGENTSERVER_DISPATCH_CONSTRAINTS,
  STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
  STAGE_CONVERSATION_POLICY,
  STAGE_DIRECT_CONTEXT_FAST_PATH,
  STAGE_REQUEST_ENRICHMENT,
  STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
  STAGE_VISION_SENSE_RUNTIME,
  runWorkspaceRuntimeGateway,
} from './generation-gateway.js';

test('runtime gateway fails closed before AgentServer when conversation policy fails without turn constraints', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-policy-fail-closed-'));
  const original = {
    mode: process.env.SCIFORGE_CONVERSATION_POLICY_MODE,
    command: process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON,
  };
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'active';
  process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON = '/usr/bin/false';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Summarize current context from available refs.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
    });

    assert.equal(payload.artifacts[0]?.id, 'runtime-execution-forbidden');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.conversation-policy');
    assert.match(payload.message, /fail-closed|没有启动新的 runtime/);
    assert.doesNotMatch(JSON.stringify(payload), /agentserver\.generate/);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
    assert.equal(displayIntent.conversationProjection?.visibleAnswer?.status, 'degraded-result');
    assert.match(String(displayIntent.conversationProjection?.visibleAnswer?.text), /fail-closed|runtime/i);
    assert.equal(displayIntent.taskOutcomeProjection?.conversationEventLog?.schemaVersion, 'sciforge.conversation-event-log.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original.mode);
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_PYTHON', original.command);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('stateless fresh policy timeout falls through to AgentServer generation without reusing context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-policy-fresh-fallback-'));
  const original = {
    mode: process.env.SCIFORGE_CONVERSATION_POLICY_MODE,
    command: process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON,
  };
  let sawGeneration = false;
  let requestBody = '';
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'fresh-policy-fallback', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawGeneration = true;
    requestBody = await readBody(req);
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-fresh-policy-fallback',
          status: 'completed',
          output: {
            result: {
              message: 'Primer design needs GC and specificity checks to keep binding stable and avoid off-target amplification.',
              confidence: 0.88,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              reasoningTrace: 'Stateless fresh fallback used AgentServer generation after policy timeout without prior context reuse.',
              claims: [],
              uiManifest: [],
              executionUnits: [{ id: 'agentserver-fresh-answer', tool: 'agentserver.generation', status: 'done' }],
              artifacts: [],
            },
          },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'active';
    process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON = '/usr/bin/false';
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Give three concise points about why primer design checks GC content and specificity. Do not retrieve or run code.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      artifacts: [],
      references: [],
      uiState: {
        contextReusePolicy: { mode: 'fresh', historyReuse: { allowed: false } },
        sessionMessages: [{ id: 'msg-user', role: 'user', content: 'fresh stateless question' }],
      },
    });

    assert.equal(sawGeneration, true);
    assert.match(requestBody, /fresh stateless question|primer design/i);
    assert.match(payload.message, /Primer design needs GC/);
    assert.doesNotMatch(payload.message, /conversation policy timed out|fail-closed/i);
    assert.equal(payload.executionUnits[0]?.status, 'done');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original.mode);
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_PYTHON', original.command);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('agentServerForbidden constraints override forced AgentServer generation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-forbidden-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use existing current refs only.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
      uiState: {
        forceAgentServerGeneration: true,
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: true,
          workspaceExecutionForbidden: false,
          externalIoForbidden: false,
          codeExecutionForbidden: false,
          reasons: ['AgentServer dispatch is forbidden by structured current-turn constraints.'],
          evidence: { hasPriorContext: true, referenceCount: 1 },
        },
      },
    });

    assert.equal(payload.artifacts[0]?.id, 'agentserver-dispatch-forbidden');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.turn-execution-constraints');
    assert.match(payload.message, /没有启动 AgentServer/);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
    assert.equal(displayIntent.conversationProjection?.visibleAnswer?.status, 'degraded-result');
    assert.match(String(displayIntent.conversationProjection?.visibleAnswer?.text), /AgentServer|runtime/i);
    assert.equal(displayIntent.taskOutcomeProjection?.conversationEventLog?.schemaVersion, 'sciforge.conversation-event-log.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('provider preflight blocks before sense or backend dispatch for explicit provider tasks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-preflight-first-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Require web_search provider route for recent papers; do not run backend network code.',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      references: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
      },
    });

    assert.match(payload.message, /Capability provider route preflight blocked AgentServer dispatch/);
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.workspace-runtime-gateway');
    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(JSON.stringify(payload), /capability-provider-preflight/);
    assert.doesNotMatch(JSON.stringify(payload), /vision-sense-observation|agentserver-response/);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('gateway pipeline audit records stage sequence and replayable registry order', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-pipeline-audit-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  const events: any[] = [];
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use existing current refs only.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
      uiState: {
        forceAgentServerGeneration: true,
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: true,
          workspaceExecutionForbidden: false,
          externalIoForbidden: false,
          codeExecutionForbidden: false,
          reasons: ['AgentServer dispatch is forbidden by structured current-turn constraints.'],
          evidence: { hasPriorContext: true, referenceCount: 1 },
        },
      },
    }, {
      onEvent(event) {
        events.push(event);
      },
    });

    assert.match(payload.message, /没有启动 AgentServer/);
    assert.deepEqual(
      GATEWAY_PIPELINE_STAGES.map((stage) => stage.name),
      GATEWAY_PIPELINE_STAGE_ORDER,
    );
    const registryAudit = events.find((event) => event.type === 'gateway-pipeline-registry-audit');
    assert.ok(registryAudit);
    assert.deepEqual(registryAudit.raw.stageOrder, GATEWAY_PIPELINE_STAGE_ORDER);
    assert.deepEqual(
      registryAudit.raw.stages.map((stage: Record<string, unknown>) => stage.name),
      GATEWAY_PIPELINE_STAGE_ORDER,
    );
    const stageAudits = events.filter((event) => event.type === 'gateway-pipeline-stage-audit');
    assert.deepEqual(
      stageAudits.map((event) => event.raw.stage),
      [
        STAGE_CONVERSATION_POLICY,
        STAGE_REQUEST_ENRICHMENT,
        STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
        STAGE_DIRECT_CONTEXT_FAST_PATH,
        STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
        STAGE_VISION_SENSE_RUNTIME,
        STAGE_AGENTSERVER_DISPATCH_CONSTRAINTS,
      ],
    );
    assert.deepEqual(
      stageAudits.map((event) => event.raw.shortCircuit),
      [false, false, false, false, false, false, true],
    );
    const dispatchAudit = stageAudits.at(-1);
    assert.equal(dispatchAudit.raw.stage, STAGE_AGENTSERVER_DISPATCH_CONSTRAINTS);
    assert.equal(dispatchAudit.raw.payloadSummary.claimType, 'runtime-diagnostic');
    assert.equal(dispatchAudit.raw.payloadSummary.executionUnitCount, 1);
    assert.deepEqual(dispatchAudit.raw.payloadSummary.artifactIds, ['agentserver-dispatch-forbidden']);
    assert.match(dispatchAudit.raw.payloadSummary.message, /没有启动 AgentServer/);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('code and external IO forbidden constraints still allow plain AgentServer answer when no runtime work is selected', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-answer-only-constraints-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  let sawAgentServerGenerate = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'answer-only-constraints', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawAgentServerGenerate = true;
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-answer-only-constraints',
          status: 'completed',
          output: {
            result: {
              message: 'GC content affects primer melting behavior; specificity reduces off-target amplification.',
              confidence: 0.88,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              reasoningTrace: 'Answered without workspace code execution or external IO.',
              claims: [],
              uiManifest: [],
              executionUnits: [{ id: 'agentserver-answer-only', tool: 'agentserver.generation', status: 'done' }],
              artifacts: [],
            },
          },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Explain primer design checks. Do not retrieve, read files, or run code.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      artifacts: [],
      references: [],
      uiState: {
        selectedToolIds: ['default-report-view'],
        selectedActionIds: ['default-followup-action'],
        selectedVerifierIds: ['default-verifier'],
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: false,
          workspaceExecutionForbidden: true,
          externalIoForbidden: true,
          codeExecutionForbidden: true,
          reasons: ['No retrieval or code execution requested.'],
          evidence: { hasPriorContext: false, referenceCount: 0 },
        },
      },
    });

    assert.equal(sawAgentServerGenerate, true);
    assert.match(payload.message, /GC content/);
    assert.doesNotMatch(payload.message, /fail-closed|禁止新的 runtime/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repair-continuation bounded stop returns terminal repair payload instead of backend failure', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-repair-bounded-stop-'));
  const originalPolicy = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  let sawAgentServerGenerate = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          session: { id: 'session-repair-bounded-stop', status: 'active' },
          workBudget: { status: 'healthy', approxCurrentWorkTokens: 100 },
          recentTurns: [],
          currentWorkEntries: [],
        },
      }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawAgentServerGenerate = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({
      event: {
        type: 'usage-update',
        usage: { input: 55_000, output: 5_001, total: 60_001, provider: 'mock' },
      },
    })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: 'Continue the failed run from the compact refs and do not restart broad generation.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      maxContextWindowTokens: 200_000,
      artifacts: [],
      uiState: {
        forceAgentServerGeneration: true,
        contextReusePolicy: { mode: 'repair' },
        currentReferenceDigests: [{ ref: 'artifact:prior-digest', digestRef: '.sciforge/digests/prior.json', title: 'Prior digest' }],
        recentExecutionRefs: [{
          id: 'EU-prior-failed',
          status: 'failed-with-reason',
          outputRef: '.sciforge/task-results/prior.json',
          stdoutRef: '.sciforge/task-results/prior.stdout.txt',
          stderrRef: '.sciforge/task-results/prior.stderr.txt',
          failureReason: 'prior bounded-stop',
        }],
      },
    });

    assert.equal(sawAgentServerGenerate, true);
    assert.match(payload.message, /repair|needs repair|bounded-stop/i);
    assert.doesNotMatch(payload.message, /backend failed/i);
    const unit = payload.executionUnits[0] as Record<string, unknown>;
    assert.equal(unit.status, 'repair-needed');
    assert.equal(unit.blocker, 'repair-continuation-bounded-stop');
    assert.match(String(unit.failureReason), /repair generation bounded-stop after 60001 total tokens/);
    assert.ok(Array.isArray(unit.recoverActions));
    assert.ok((unit.recoverActions as string[]).some((action) => /refs\/digests-only|currentReferenceDigests|recentExecutionRefs/i.test(action)));
    assert.match(String(unit.nextStep), /refs\/digests-only|minimal repair/i);
    assert.match(JSON.stringify(unit.refs), /repair-continuation/);
    assert.match(JSON.stringify(unit.refs), /prior\.stderr\.txt/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', originalPolicy);
    await rm(workspace, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
