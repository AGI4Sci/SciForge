import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runWorkspaceRuntimeGateway } from './generation-gateway.js';

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
