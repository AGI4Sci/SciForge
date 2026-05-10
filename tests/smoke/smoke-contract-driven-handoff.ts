import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

type Dispatch = {
  text: string;
  serialized: string;
  metadata: Record<string, unknown>;
  runtimeMetadata: Record<string, unknown>;
  topLevelMetadata: Record<string, unknown>;
};

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-contract-driven-handoff-'));
const staleFailure = 'SHOULD_NOT_REACH_CONTRACT_HANDOFF';
const staleLogRef = '.sciforge/logs/stale-contract-handoff.stderr.log';
const dispatches: Dispatch[] = [];

await appendTaskAttempt(workspace, {
  id: 'stale-contract-handoff-attempt',
  attempt: 1,
  prompt: 'Create a fresh contract-driven handoff report.',
  skillDomain: 'literature',
  createdAt: '2026-05-01T00:00:00.000Z',
  codeRef: '.sciforge/tasks/stale-contract-handoff.py',
  outputRef: '.sciforge/task-results/stale-contract-handoff.json',
  stdoutRef: '.sciforge/logs/stale-contract-handoff.stdout.log',
  stderrRef: staleLogRef,
  exitCode: 1,
  status: 'failed-with-reason',
  failureReason: staleFailure,
  schemaErrors: [],
});

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'contract-driven-handoff-smoke', status: 'active' },
        operationalGuidance: { summary: ['mock context available'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 40 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }

  if (req.method !== 'POST' || !['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }

  const body = await readJson(req);
  dispatches.push(captureDispatch(body));
  const result = {
    ok: true,
    data: {
      run: {
        id: `contract-driven-handoff-${dispatches.length}`,
        status: 'completed',
        output: {
          result: {
            message: 'Contract-driven handoff smoke completed.',
            confidence: 0.87,
            claimType: 'runtime-smoke',
            evidenceLevel: 'mock-agentserver',
            reasoningTrace: 'Mock AgentServer captured handoff metadata.',
            claims: [{ text: 'Contract handoff used current refs attempt:failed-current log:current-stderr artifact:previous-report.' }],
            uiManifest: [],
            executionUnits: [{ id: `EU-handoff-${dispatches.length}`, tool: 'agentserver.mock', status: 'done' }],
            artifacts: [{
              id: `handoff-report-${dispatches.length}`,
              type: 'research-report',
              data: {
                markdown: 'Contract-driven handoff smoke completed with refs attempt:failed-current log:current-stderr artifact:previous-report.',
              },
            }],
          },
        },
      },
    },
  };
  res.writeHead(200, { 'Content-Type': req.url === '/api/agent-server/runs/stream' ? 'application/x-ndjson' : 'application/json' });
  res.end(req.url === '/api/agent-server/runs/stream' ? `${JSON.stringify({ result })}\n` : JSON.stringify(result));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await runHandoffRequest('fresh', {
    harnessProfileId: 'balanced-default',
    agentHarnessInput: {
      intentMode: 'fresh',
    },
  });
  await runHandoffRequest('continuation', {
    harnessProfileId: 'balanced-default',
    contextReusePolicy: { mode: 'continue', historyReuse: { allowed: true } },
    currentReferences: [{ kind: 'artifact', ref: 'artifact:previous-report', title: 'Previous report' }],
    recentConversation: ['user: make a literature report', 'assistant: produced artifact:previous-report'],
    recentExecutionRefs: [{
      id: 'execution-unit:previous-report-task',
      status: 'done',
      outputRef: 'artifact:previous-report',
      stdoutRef: 'log:previous-report-stdout',
    }],
    agentHarnessInput: {
      intentMode: 'continuation',
      contextRefs: ['artifact:previous-report', 'execution-unit:previous-report-task', 'log:previous-report-stdout'],
      requiredContextRefs: ['artifact:previous-report'],
      blockedContextRefs: ['artifact:unrelated-prior'],
    },
  });
  await runHandoffRequest('repair', {
    harnessProfileId: 'debug-repair',
    contextReusePolicy: { mode: 'repair', historyReuse: { allowed: true } },
    currentReferences: [
      { kind: 'attempt', ref: 'attempt:failed-current', title: 'Failed current attempt' },
      { kind: 'log', ref: 'log:current-stderr', title: 'Current stderr' },
    ],
    recentExecutionRefs: [{
      id: 'attempt:failed-current',
      status: 'repair-needed',
      outputRef: 'artifact:failed-output',
      stderrRef: 'log:current-stderr',
    }],
    agentHarnessInput: {
      intentMode: 'repair',
      contextRefs: ['artifact:failed-output', 'attempt:failed-current', 'log:current-stderr'],
      requiredContextRefs: ['attempt:failed-current', 'log:current-stderr'],
      blockedContextRefs: ['artifact:unrelated-prior'],
      conversationSignals: { validationFailure: true },
    },
  });

  assert.equal(dispatches.length, 3);
  const [fresh, continuation, repair] = dispatches;
  assert.ok(fresh && continuation && repair);

  assertHandoff(fresh, {
    intentMode: 'fresh',
    profileId: 'balanced-default',
    allowed: [],
    blocked: [],
    required: [],
  });
  assert.equal(fresh.metadata.priorAttemptCount, 0);
  assertNoStaleRefs(fresh);

  assertHandoff(continuation, {
    intentMode: 'continuation',
    profileId: 'balanced-default',
    allowed: ['artifact:previous-report', 'execution-unit:previous-report-task', 'log:previous-report-stdout'],
    blocked: ['artifact:unrelated-prior'],
    required: ['artifact:previous-report'],
  });
  assertNoStaleRefs(continuation);

  assertHandoff(repair, {
    intentMode: 'repair',
    profileId: 'debug-repair',
    allowed: ['artifact:failed-output', 'attempt:failed-current', 'log:current-stderr'],
    blocked: ['artifact:unrelated-prior'],
    required: ['attempt:failed-current', 'log:current-stderr'],
  });
  const repairHandoff = handoff(repair);
  assert.equal(record(repairHandoff.repairContextPolicy).kind, 'repair-rerun');
  assert.equal(record(repairHandoff.repairContextPolicy).includeStdoutSummary, true);
  assertNoStaleRefs(repair);

  for (const dispatch of dispatches) {
    const payloadHandoff = handoff(dispatch);
    assert.deepEqual(dispatch.runtimeMetadata.agentHarnessHandoff, payloadHandoff);
    assert.deepEqual(dispatch.topLevelMetadata.agentHarnessHandoff, payloadHandoff);
    assertPromptDirectivesAreSourced(payloadHandoff);
    assert.equal(dispatch.text.includes(String(dispatch.metadata.harnessContractRef)), false);
    assert.equal(dispatch.text.includes(String(dispatch.metadata.harnessTraceRef)), false);
  }

  console.log('[ok] contract-driven handoff carries harness refs for fresh/continuation/repair without live backend');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function runHandoffRequest(kind: 'fresh' | 'continuation' | 'repair', uiState: Record<string, unknown>) {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: `${kind}: Create a contract-driven handoff report.`,
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    uiState: {
      ...uiState,
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: ['report-viewer'],
    },
    artifacts: [],
  });
  assert.equal(result.message, 'Contract-driven handoff smoke completed.');
}

function captureDispatch(body: unknown): Dispatch {
  const payload = record(body);
  const input = record(payload.input);
  const runtime = record(payload.runtime);
  return {
    text: typeof input.text === 'string' ? input.text : '',
    serialized: JSON.stringify(payload),
    metadata: record(input.metadata),
    runtimeMetadata: record(runtime.metadata),
    topLevelMetadata: record(payload.metadata),
  };
}

function assertHandoff(dispatch: Dispatch, expected: {
  intentMode: string;
  profileId: string;
  allowed: string[];
  blocked: string[];
  required: string[];
}) {
  const payloadHandoff = handoff(dispatch);
  assert.equal(dispatch.metadata.harnessProfileId, expected.profileId);
  assert.equal(payloadHandoff.harnessProfileId, expected.profileId);
  assert.equal(payloadHandoff.intentMode, expected.intentMode);
  assert.equal(payloadHandoff.harnessContractRef, dispatch.metadata.harnessContractRef);
  assert.equal(payloadHandoff.harnessTraceRef, dispatch.metadata.harnessTraceRef);
  assert.equal(payloadHandoff.decisionOwner, 'AgentServer');
  assert.equal(payloadHandoff.schemaVersion, 'sciforge.agent-harness-handoff.v1');
  const contextRefs = record(payloadHandoff.contextRefs);
  assert.deepEqual(list(contextRefs.allowed), expected.allowed);
  assert.deepEqual(list(contextRefs.blocked), expected.blocked);
  assert.deepEqual(list(contextRefs.required), expected.required);
}

function assertNoStaleRefs(dispatch: Dispatch) {
  assert.equal(dispatch.serialized.includes(staleFailure), false);
  assert.equal(dispatch.serialized.includes(staleLogRef), false);
}

function assertPromptDirectivesAreSourced(payloadHandoff: Record<string, unknown>) {
  const directives = array(payloadHandoff.promptDirectives).map(record);
  for (const directive of directives) {
    assert.equal(typeof directive.id, 'string');
    assert.equal(typeof directive.sourceCallbackId, 'string');
  }
}

function handoff(dispatch: Dispatch) {
  return record(dispatch.metadata.agentHarnessHandoff);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function list(value: unknown) {
  return array(value).filter((item): item is string => typeof item === 'string');
}
