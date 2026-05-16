import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { join } from 'node:path';

import { requestWithPolicyResponse } from '../../src/runtime/conversation-policy/apply.js';
import { CONVERSATION_POLICY_RESPONSE_VERSION, normalizeConversationPolicyResponse } from '@sciforge-ui/runtime-contract/conversation-policy';
import type { GatewayRequest, WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types.js';
import { createLatencyTelemetry } from '../../src/runtime/gateway/latency-telemetry.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { applyBackgroundCompletionEventToSession } from '../../src/ui/src/app/chat/sessionTransforms.js';
import type { SciForgeSession } from '../../src/ui/src/domain.js';

const fixtures: Array<{
  id: string;
  payload: Record<string, unknown>;
  expect: {
    executionMode?: string;
    firstVisibleMaxMs?: number;
    blockOnCompaction?: boolean;
    blockOnVerification?: boolean;
    backgroundEnabled?: boolean;
  };
}> = [
  {
    id: 'ordinary-followup',
    payload: {
      turn: { text: 'What does the previous conclusion mean in one paragraph?' },
      session: {
        messages: ['user: summarize this result', 'assistant: prior conclusion is available'],
        artifacts: [{ id: 'prior-note', artifactType: 'note', status: 'done', summary: 'prior conclusion' }],
      },
    },
    expect: { firstVisibleMaxMs: 1200, blockOnCompaction: false },
  },
  {
    id: 'artifact-followup',
    payload: {
      turn: {
        text: '解释这个已有结果表的置信区间是什么意思。',
        refs: [{ kind: 'artifact', ref: 'artifact:metrics-table', title: 'metrics table' }],
      },
      session: { artifacts: [{ id: 'metrics-table', artifactType: 'table', status: 'done', summary: 'model metrics', dataRef: '.sciforge/artifacts/metrics-table.json' }] },
    },
    expect: { executionMode: 'direct-context-answer', firstVisibleMaxMs: 1200, backgroundEnabled: false },
  },
  {
    id: 'low-risk-current-events',
    payload: {
      turn: { text: 'Search today latest release status and give a brief answer.' },
      policyHints: { selectedTools: [{ id: 'web.search', summary: 'Search current web pages.' }] },
    },
    expect: { executionMode: 'thin-reproducible-adapter', firstVisibleMaxMs: 3000, backgroundEnabled: true },
  },
  {
    id: 'literature-retrieval',
    payload: {
      turn: { text: '搜索几篇关于 graph retrieval 的近期论文，给我标题和链接。' },
      policyHints: { selectedCapabilities: [{ id: 'literature.search', summary: 'Search academic literature.' }] },
    },
    expect: { executionMode: 'single-stage-task', firstVisibleMaxMs: 3000 },
  },
  {
    id: 'long-report',
    payload: {
      turn: { text: '做一个系统性文献调研，比较近期研究证据，输出报告和证据表。' },
      policyHints: {
        selectedCapabilities: [{ id: 'literature.search', summary: 'Search academic sources.' }],
        selectedVerifiers: [{ id: 'citation.checker', summary: 'Validate citations.' }],
      },
    },
    expect: { executionMode: 'multi-stage-project', blockOnVerification: true, backgroundEnabled: true },
  },
  {
    id: 'failed-repair',
    payload: {
      turn: { text: '根据日志修复上一轮失败。' },
      policyHints: { failure: { stageId: 'validate', status: 'failed', failureReason: 'schema mismatch' } },
    },
    expect: { executionMode: 'repair-or-continue-project', blockOnVerification: true },
  },
  {
    id: 'high-risk-action',
    payload: {
      turn: { text: '删除工作区里过期的发布产物。' },
      policyHints: {
        humanApprovalRequired: true,
        selectedActions: [{ id: 'workspace.delete', kind: 'action', summary: 'Delete workspace files.', riskLevel: 'high', sideEffects: ['delete'] }],
      },
    },
    expect: { blockOnVerification: true, backgroundEnabled: false, firstVisibleMaxMs: 8000 },
  },
  {
    id: 'context-near-limit',
    payload: {
      turn: { text: 'Explain what this referenced note means.', refs: [{ kind: 'path', ref: '/workspace/out/note.md' }] },
      limits: { contextBudget: { remainingTokens: 512, totalTokens: 128000 } },
    },
    expect: { executionMode: 'direct-context-answer', blockOnCompaction: true, firstVisibleMaxMs: 8000 },
  },
  {
    id: 'backend-silent-stream',
    payload: {
      turn: { text: 'Search current evidence, but recover cleanly if the backend stream goes silent.' },
      policyHints: { selectedTools: [{ id: 'web.search', summary: 'Search current web pages.' }] },
    },
    expect: { executionMode: 'thin-reproducible-adapter', backgroundEnabled: true },
  },
  {
    id: 'mid-run-guidance',
    payload: {
      turn: { text: '下一阶段继续生成表格。' },
      session: { artifacts: [{ artifactType: 'task-project', status: 'running' }] },
      policyHints: { userGuidanceQueue: [{ text: '只保留开放获取来源，不要付费来源。' }] },
    },
    expect: { executionMode: 'repair-or-continue-project', blockOnCompaction: false },
  },
];

for (const fixture of fixtures) {
  const rawResponse = await callPythonPolicy({
    schemaVersion: 'sciforge.conversation-policy.request.v1',
    requestId: `t098-${fixture.id}`,
    ...fixture.payload,
  });
  assert.equal(rawResponse.schemaVersion, CONVERSATION_POLICY_RESPONSE_VERSION, fixture.id);
  const response = normalizeConversationPolicyResponse(rawResponse);
  assert.ok(response, `${fixture.id} should normalize as a TS bridge response`);

  const executionMode = String(response.executionModePlan?.executionMode ?? '');
  const latencyPolicy = response.latencyPolicy ?? {};
  const backgroundPlan = response.backgroundPlan ?? {};
  const cachePolicy = response.cachePolicy ?? {};

  if (fixture.expect.executionMode) assert.equal(executionMode, fixture.expect.executionMode, fixture.id);
  if (fixture.expect.firstVisibleMaxMs) {
    assert.ok(Number(latencyPolicy.firstVisibleResponseMs) <= fixture.expect.firstVisibleMaxMs, `${fixture.id} first visible SLA`);
  }
  if (fixture.expect.blockOnCompaction !== undefined) {
    assert.equal(latencyPolicy.blockOnContextCompaction, fixture.expect.blockOnCompaction, `${fixture.id} compaction policy`);
  }
  if (fixture.expect.blockOnVerification !== undefined) {
    assert.equal(latencyPolicy.blockOnVerification, fixture.expect.blockOnVerification, `${fixture.id} verification policy`);
  }
  if (fixture.expect.backgroundEnabled !== undefined) {
    assert.equal(backgroundPlan.enabled, fixture.expect.backgroundEnabled, `${fixture.id} background policy`);
  }
  assert.equal(typeof latencyPolicy.silentRetryMs, 'number', `${fixture.id} silent retry policy`);
  assert.equal(typeof cachePolicy.reason, 'string', `${fixture.id} cache policy reason`);
  const auditTrace = Array.isArray(rawResponse.auditTrace) ? rawResponse.auditTrace.filter(isRecord) : [];
  assert.ok(auditTrace.some((entry) => entry.event === 'module.latency_policy'), `${fixture.id} policy came from Python latency module`);

  const enriched = requestWithPolicyResponse(baseGatewayRequest(fixture.id), response);
  assert.deepEqual(enriched.uiState?.latencyPolicy, response.latencyPolicy, `${fixture.id} latency policy should be passed through`);
  assert.deepEqual(enriched.uiState?.responsePlan, response.responsePlan, `${fixture.id} response plan should be passed through`);
  assert.deepEqual(enriched.uiState?.backgroundPlan, response.backgroundPlan, `${fixture.id} background plan should be passed through`);
  assert.deepEqual(enriched.uiState?.cachePolicy, response.cachePolicy, `${fixture.id} cache policy should be passed through`);
}

let clock = 1_000;
const events: WorkspaceRuntimeEvent[] = [];
const telemetry = createLatencyTelemetry(baseGatewayRequest('telemetry'), {
  onEvent: (event) => events.push(event),
}, {
  now: () => clock,
});
telemetry.markPolicyApplication({
  request: requestWithPolicyResponse(baseGatewayRequest('telemetry'), normalizeConversationPolicyResponse({
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    cachePolicy: {
      reuseScenarioPlan: true,
      reuseSkillPlan: false,
      reuseUiPlan: true,
      reuseReferenceDigests: false,
      reuseArtifactIndex: true,
      reuseLastSuccessfulStage: false,
      reuseBackendSession: true,
    },
  })!),
  response: normalizeConversationPolicyResponse({ schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION })!,
  status: 'applied',
});
clock += 120;
telemetry.observeEvent({ type: 'workspace-skill-selected', source: 'workspace-runtime', message: 'visible status' });
clock += 80;
telemetry.observeEvent({ type: 'backend-event', source: 'mock-agentserver', text: 'first backend token' });
clock += 20;
telemetry.observeEvent({ type: 'contextCompaction', source: 'workspace-runtime', status: 'started', message: 'compacting' });
clock += 75;
telemetry.observeEvent({ type: 'contextCompaction', source: 'workspace-runtime', status: 'completed', message: 'done' });
telemetry.markVerificationStart();
clock += 33;
telemetry.markVerificationEnd();
const payload = telemetry.emitFinal({
  message: 'ok',
  confidence: 0.9,
  claimType: 'status',
  evidenceLevel: 'runtime',
  reasoningTrace: 'mock',
  claims: [],
  uiManifest: [],
  executionUnits: [],
  artifacts: [],
});
assert.ok(payload?.workEvidence?.some((entry) => entry.rawRef === 'runtime://latency-diagnostics'));
const diagnosticEvent = events.find((event) => event.type === 'latency-diagnostics');
assert.ok(diagnosticEvent);
const diagnosticRaw = diagnosticEvent.raw as Record<string, unknown>;
assert.equal(diagnosticRaw.timeToFirstVisibleResponseMs, 120);
assert.equal(diagnosticRaw.timeToFirstBackendEventMs, 200);
assert.equal(diagnosticRaw.compactionWaitMs, 75);
assert.equal(diagnosticRaw.verificationWaitMs, 33);
assert.deepEqual((diagnosticRaw.cache as { hits: string[] }).hits.sort(), ['reuseArtifactIndex', 'reuseBackendSession', 'reuseScenarioPlan', 'reuseUiPlan'].sort());

const sessionAfterBackground = applyBackgroundCompletionEventToSession(emptySession(), {
  contract: 'sciforge.background-completion.v1',
  type: 'background-finalization',
  runId: 'run-bg-duration',
  stageId: 'stage-final',
  status: 'completed',
  createdAt: '2026-05-08T02:00:00.000Z',
  completedAt: '2026-05-08T02:02:30.000Z',
  finalResponse: 'done',
});
const backgroundRaw = sessionAfterBackground.runs[0].raw as { backgroundCompletion?: { diagnostics?: { backgroundCompletionDurationMs?: number } } };
assert.equal(backgroundRaw.backgroundCompletion?.diagnostics?.backgroundCompletionDurationMs, 150000);

const directWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-t098-direct-context-'));
const directEvents: WorkspaceRuntimeEvent[] = [];
const direct = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: '解释这个已有结果表的置信区间是什么意思。',
  workspacePath: directWorkspace,
  artifacts: [{
    id: 'metrics-table',
    type: 'table',
    artifactType: 'table',
    producerScenario: 'literature',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/metrics-table.json',
    data: { markdown: 'Prior table: confidence interval summarizes uncertainty around the model estimate.' },
  }],
  uiState: {
    sessionId: 'session-t098-direct-context',
    recentConversation: ['user: generate metrics table', 'assistant: metrics table is ready'],
    recentExecutionRefs: [{
      id: 'unit-metrics',
      status: 'done',
      outputRef: '.sciforge/task-results/metrics.json',
      stdoutRef: '.sciforge/logs/metrics.stdout.log',
      stderrRef: '.sciforge/logs/metrics.stderr.log',
    }],
  },
}, { onEvent: (event) => directEvents.push(event) });
assert.equal(directEvents.some((event) => event.type === 'direct-context-fast-path'), true);
assert.match(direct.message, /Prior table: confidence interval summarizes uncertainty/);
assert.equal(direct.executionUnits.some((unit) => unit.tool === 'sciforge.direct-context-fast-path'), true);
assert.equal(direct.executionUnits.some((unit) => unit.tool === 'sciforge.workspace-runtime-gateway'), false);
assert.equal(direct.executionUnits[0]?.status, 'done');
assert.equal(direct.verificationResults?.[0]?.verdict, 'unverified');
assert.equal((direct.displayIntent?.verification as { nonBlocking?: boolean } | undefined)?.nonBlocking, false);
assert.equal(
  direct.artifacts.some((artifact) =>
    artifact.type === 'verification-result'
    && (artifact.metadata as { nonBlocking?: boolean; unverifiedIsNotPass?: boolean } | undefined)?.nonBlocking === false
    && (artifact.metadata as { nonBlocking?: boolean; unverifiedIsNotPass?: boolean } | undefined)?.unverifiedIsNotPass === true
  ),
  true,
);

const repairProviderWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-t098-repair-provider-route-'));
const repairProviderEvents: WorkspaceRuntimeEvent[] = [];
const repairProvider = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: [
    'continue from the last bounded stop. do not start long generation.',
    'produce one minimal single stage result only.',
    'if web_search or web_fetch provider routes are usable then create a minimal adapter task that uses those provider routes.',
    'if this cannot be determined in this turn then return a valid failed-with-reason ToolPayload with failure reason, recover actions, next step, and refs.',
  ].join(' '),
  workspacePath: repairProviderWorkspace,
  artifacts: [{
    id: 'bounded-stop-diagnostic',
    type: 'runtime-diagnostic',
    artifactType: 'runtime-diagnostic',
    producerScenario: 'literature',
    schemaVersion: '1',
    data: { markdown: 'Prior run stopped at bounded repair guard with reusable refs.' },
  }],
  uiState: {
    sessionId: 'session-t098-repair-provider-route',
    recentExecutionRefs: [{
      id: 'bounded-stop-unit',
      status: 'repair-needed',
      outputRef: '.sciforge/task-results/bounded-stop.json',
      stderrRef: '.sciforge/logs/bounded-stop.stderr.log',
      failureReason: 'AgentServer repair generation bounded-stop after token guard.',
    }],
  },
}, { onEvent: (event) => repairProviderEvents.push(event) });
assert.equal(repairProviderEvents.some((event) => event.type === 'direct-context-fast-path'), false);
assert.equal(repairProvider.executionUnits.some((unit) => unit.tool === 'sciforge.capability-provider-preflight'), false);
assert.equal(repairProvider.executionUnits.some((unit) => unit.tool === 'sciforge.workspace-runtime-gateway'), true);
const repairRouteDecision = isRecord(repairProvider.executionUnits[0]?.routeDecision)
  ? repairProvider.executionUnits[0].routeDecision
  : {};
const repairProviderRoutes = Array.isArray(repairRouteDecision.capabilityProviderRoutes)
  ? repairRouteDecision.capabilityProviderRoutes.filter(isRecord)
  : [];
assert.equal(repairProviderRoutes.some((route) => route.capabilityId === 'web_search'), true);
assert.equal(repairProviderRoutes.some((route) => route.capabilityId === 'web_fetch'), true);
assert.match(repairProvider.message, /AgentServer task generation|AgentServer/);
assert.doesNotMatch(repairProvider.message, /Tool\/provider status answered/);

console.log('[ok] T098 latency diagnostics matrix covers Python-owned policy fields, TS pass-through, cache hit/miss telemetry, waits, silent-stream timing, background duration, direct-context finalization, and AgentServer repair routing without preflight result shortcuts');

function callPythonPolicy(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const pythonPath = [resolve(process.cwd(), 'packages/reasoning/conversation-policy/src'), process.env.PYTHONPATH].filter(Boolean).join(delimiter);
    const child = spawn(process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON || 'python3', ['-m', 'sciforge_conversation.service'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: pythonPath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`conversation policy exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`invalid policy JSON: ${String(error)}\n${stdout}\n${stderr}`));
      }
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function baseGatewayRequest(id: string): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: `T098 ${id}`,
    artifacts: [],
    uiState: { sessionId: `session-t098-${id}` },
  };
}

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-t098-background-duration',
    scenarioId: 'literature-evidence-review',
    title: 'T098 background duration',
    createdAt: '2026-05-08T02:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-08T02:00:00.000Z',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
