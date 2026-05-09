import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { readRecentTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import { collectWorkEvidence, type WorkEvidence } from '../../src/runtime/gateway/work-evidence-types.js';
import type { ToolPayload, WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-t097-execution-mode-matrix-'));
process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';

const workEvidenceFixture: WorkEvidence[] = [{
  kind: 'retrieval',
  status: 'success',
  provider: 'generic-provider',
  input: { query: 'execution mode matrix fixture' },
  resultCount: 2,
  outputSummary: 'T097 shared WorkEvidence fixture confirms durable refs and runner evidence.',
  evidenceRefs: ['file:.sciforge/evidence/t097-work-evidence.json'],
  recoverActions: [],
  diagnostics: ['provider status 200', 'fallback not required'],
  rawRef: 'file:.sciforge/evidence/t097-work-evidence.json',
}];

const cases: Array<{
  id: string;
  executionMode: string;
  prompt: string;
  expectedComponents: string[];
  runnerKind: 'direct-payload' | 'generated-task';
  stageHint: string;
}> = [
  {
    id: 'direct-context',
    executionMode: 'direct-context-answer',
    prompt: 'T097:direct-context 根据上文已有报告给出一句结论，不要重新检索。',
    expectedComponents: ['report-viewer', 'execution-unit-table'],
    runnerKind: 'direct-payload',
    stageHint: 'Answer from existing context and refs.',
  },
  {
    id: 'thin-reproducible-adapter',
    executionMode: 'thin-reproducible-adapter',
    prompt: 'T097:thin-reproducible-adapter 做一次轻量可复现查询并保留 refs。',
    expectedComponents: ['report-viewer', 'execution-unit-table'],
    runnerKind: 'generated-task',
    stageHint: 'Run one bounded adapter task.',
  },
  {
    id: 'single-stage-task',
    executionMode: 'single-stage-task',
    prompt: 'T097:single-stage-task 读取一个小输入并生成单阶段报告。',
    expectedComponents: ['report-viewer', 'execution-unit-table'],
    runnerKind: 'generated-task',
    stageHint: 'Run one bounded local computation.',
  },
  {
    id: 'multi-stage-project',
    executionMode: 'multi-stage-project',
    prompt: 'T097:multi-stage-project 拆成项目阶段，只返回当前可执行 stage。',
    expectedComponents: ['report-viewer', 'execution-unit-table'],
    runnerKind: 'generated-task',
    stageHint: 'Return only the immediately executable next stage.',
  },
  {
    id: 'repair-or-continue-project',
    executionMode: 'repair-or-continue-project',
    prompt: 'T097:repair-or-continue-project 继续上一轮失败 stage，按日志修复后重跑。',
    expectedComponents: ['report-viewer', 'execution-unit-table'],
    runnerKind: 'generated-task',
    stageHint: 'Create a minimal repair or continue stage.',
  },
];

const seenModes = new Set<string>();
const seenRunnerKinds = new Map<string, 'direct-payload' | 'generated-task'>();
const seenHandoffReasons = new Map<string, string>();

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 't097-execution-mode-session', status: 'active' },
        operationalGuidance: { summary: ['t097 context ready'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 120 },
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

  const body = await readJson(req);
  const input = isRecord(body.input) ? body.input : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const promptText = typeof input.text === 'string' ? input.text : '';
  const item = cases.find((candidate) => promptText.includes(`T097:${candidate.id}`));
  assert.ok(item, `AgentServer handoff should include a T097 case marker: ${promptText.slice(0, 240)}`);

  assert.match(String(metadata.purpose), /^workspace-task-generation(?:-inline)?$/);
  assert.equal(metadata.skillDomain, 'literature');
  assert.match(promptText, new RegExp(`"executionModeRecommendation": "${escapeRegExp(item.executionMode)}"`));
  assert.match(promptText, new RegExp(escapeRegExp(item.stageHint)));
  assert.match(promptText, new RegExp(`T097 ${escapeRegExp(item.id)} Python classifier fixture`));
  assert.match(promptText, /executionModeReason/);
  assert.match(promptText, /CURRENT TURN SNAPSHOT/);
  assert.match(promptText, /projectGuidanceAdoption/);
  assert.match(promptText, /adopted, deferred, or rejected/);

  seenModes.add(item.executionMode);
  seenHandoffReasons.set(item.executionMode, item.stageHint);

  const runId = `mock-t097-${item.id}`;
  const output = item.runnerKind === 'direct-payload'
    ? { result: toolPayloadForMode(item.id, item.executionMode, 'agentserver.direct-context') }
    : {
      result: {
        taskFiles: [{
          path: `.sciforge/tasks/t097-${item.id}.py`,
          language: 'python',
          content: generatedTaskForMode(item.id),
        }],
        entrypoint: { language: 'python', path: `.sciforge/tasks/t097-${item.id}.py` },
        environmentRequirements: { language: 'python' },
        validationCommand: `python .sciforge/tasks/t097-${item.id}.py <input> <output>`,
        expectedArtifacts: ['research-report'],
        patchSummary: `T097 ${item.id} generated runnable stage.`,
      },
    };
  seenRunnerKinds.set(item.executionMode, item.runnerKind);

  const result = {
    ok: true,
    data: {
      run: {
        id: runId,
        status: 'completed',
        output,
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
  for (const item of cases) {
    const events: WorkspaceRuntimeEvent[] = [];
    const result = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: item.prompt,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: item.expectedComponents,
      uiState: {
        sessionId: `session-t097-${item.id}`,
        freshTaskGeneration: item.runnerKind === 'generated-task',
        forceAgentServerGeneration: true,
        expectedArtifactTypes: ['research-report'],
        selectedComponentIds: item.expectedComponents,
        executionModeDecision: {
          executionModeRecommendation: item.executionMode,
          complexityScore: item.executionMode === 'direct-context-answer' ? 0.18 : 0.72,
          uncertaintyScore: item.executionMode === 'repair-or-continue-project' ? 0.57 : 0.28,
          reproducibilityLevel: item.runnerKind === 'direct-payload' ? 'none' : 'full',
          stagePlanHint: [item.stageHint],
          executionModeReason: `T097 ${item.id} Python classifier fixture`,
        },
        recentConversation: [
          `user: ${item.prompt}`,
          item.executionMode === 'repair-or-continue-project'
            ? 'assistant: prior stage failed-with-reason; repair refs are available.'
            : 'assistant: ready to execute the selected mode.',
        ],
        recentExecutionRefs: item.executionMode === 'repair-or-continue-project'
          ? [{ id: 'stage-previous', status: 'failed-with-reason', outputRef: '.sciforge/task-results/stage-previous.json' }]
          : [],
        taskProjectHandoff: item.executionMode === 'repair-or-continue-project'
          ? {
            project: { id: 't097-project', status: 'failed' },
            stage: { id: '2-research', status: 'failed' },
            userGuidanceQueue: [
              { id: 'repair-scope', status: 'queued', message: 'Broaden the failed query and keep the repair minimal.' },
            ],
          }
          : undefined,
      },
      artifacts: item.executionMode === 'direct-context-answer'
        ? [{ id: 'prior-report', type: 'research-report', data: { markdown: 'Prior report context for direct answer.' } }]
        : [],
    }, { onEvent: (event) => events.push(event) });

    assert.equal(result.executionUnits[0]?.status, 'done', `${item.id} runner status`);
    assert.equal(result.executionUnits[0]?.agentServerGenerated, true, `${item.id} should expose AgentServer runner provenance`);
    assert.ok(result.uiManifest.some((slot) => item.expectedComponents.includes(String(slot.componentId))), `${item.id} missing selected UI component`);
    assert.ok(result.artifacts.some((artifact) => artifact.type === 'research-report'), `${item.id} missing report artifact`);
    assert.ok(collectWorkEvidence(result).some((evidence) => evidence.rawRef === workEvidenceFixture[0].rawRef), `${item.id} missing shared WorkEvidence fixture`);
    assert.ok(events.some((event) => event.type === 'workspace-skill-selected'), `${item.id} missing UI/runtime selected-skill status event`);
    assert.ok(events.some((event) => event.type === 'contextWindowState'), `${item.id} missing UI/runtime context status event`);

    if (item.runnerKind === 'direct-payload') {
      assert.match(result.reasoningTrace, /AgentServer returned a SciForge ToolPayload directly/);
      assert.equal(String(result.executionUnits[0]?.outputRef).startsWith('agentserver://'), true);
      continue;
    }

    assert.match(result.reasoningTrace, new RegExp(`T097 ${escapeRegExp(item.id)} generated runnable stage`));
    const outputRef = String(result.executionUnits[0]?.outputRef ?? '');
    const taskId = outputRef.match(/generated-literature-[^.\/]+/)?.[0];
    assert.ok(taskId, `${item.id} should expose generated runner output ref`);
    const attempts = await readRecentTaskAttempts(workspace, 'literature', 12, { prompt: item.prompt });
    const attempt = attempts.find((entry) => entry.id === taskId);
    assert.equal(attempt?.status, 'done', `${item.id} attempt status`);
    assert.equal(attempt?.workEvidenceSummary?.items[0]?.rawRef, workEvidenceFixture[0].rawRef, `${item.id} attempt should persist WorkEvidence`);
    assert.equal(attempt?.workEvidenceSummary?.items[0]?.resultCount, workEvidenceFixture[0].resultCount, `${item.id} attempt should persist evidence count`);
    if (item.executionMode === 'repair-or-continue-project') {
      const unit = result.executionUnits[0] as { guidanceDecisions?: Array<{ id: string; status: string }> };
      assert.deepEqual(unit.guidanceDecisions?.map((decision) => `${decision.id}:${decision.status}`), ['repair-scope:adopted']);
    }
  }

  assert.deepEqual([...seenModes].sort(), cases.map((item) => item.executionMode).sort());
  assert.deepEqual([...seenRunnerKinds.values()].sort(), ['direct-payload', 'generated-task', 'generated-task', 'generated-task', 'generated-task'].sort());
  assert.equal(seenHandoffReasons.size, cases.length);
  console.log('[ok] T097 executionMode smoke matrix covers handoff, runner refs, shared WorkEvidence, and UI runtime status');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function toolPayloadForMode(id: string, executionMode: string, tool: string): ToolPayload {
  return {
    message: `T097 ${id} completed via ${executionMode}.`,
    confidence: 0.9,
    claimType: 'execution-mode-smoke',
    evidenceLevel: 'runtime',
    reasoningTrace: `T097 ${id} direct payload used shared WorkEvidence fixture.`,
    claims: [{
      text: `T097 ${id} preserved executionMode handoff and evidence refs.`,
      evidenceRefs: workEvidenceFixture[0].evidenceRefs,
    }],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: `${id}-report`, priority: 1 }],
    executionUnits: [{
      id: `t097-${id}`,
      status: 'done',
      tool,
      workEvidence: workEvidenceFixture,
    }],
    artifacts: [{
      id: `${id}-report`,
      type: 'research-report',
      schema: { type: 'object' },
      data: { markdown: `# T097 ${id}\n\nMode ${executionMode} preserved UI state and evidence refs.` },
      workEvidence: workEvidenceFixture,
    }],
  };
}

function generatedTaskForMode(id: string) {
  const fixtureJsonLiteral = JSON.stringify(JSON.stringify(workEvidenceFixture));
  return String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

ui_state = request.get("uiStateSummary") or {}
mode = (ui_state.get("executionModeDecision") or {}).get("executionModeRecommendation", "unknown")
work_evidence = json.loads(${fixtureJsonLiteral})
guidance_queue = (
    request.get("userGuidanceQueue")
    or (request.get("taskProjectHandoff") or {}).get("userGuidanceQueue")
    or (ui_state.get("taskProjectHandoff") or {}).get("userGuidanceQueue")
    or []
)
guidance_decisions = [
    {"id": item.get("id"), "status": "adopted", "reason": "Applied queued TaskProject guidance to the current repair/continue stage."}
    for item in guidance_queue
    if item.get("status") in ("queued", "deferred") and item.get("id")
]
payload = {
    "message": f"T097 ${id} completed via {mode}.",
    "confidence": 0.88,
    "claimType": "execution-mode-smoke",
    "evidenceLevel": "runtime",
    "reasoningTrace": "T097 ${id} generated task consumed inputPath/outputPath and shared WorkEvidence fixture.",
    "claims": [{
        "text": f"T097 ${id} runner preserved mode {mode}.",
        "evidenceRefs": work_evidence[0]["evidenceRefs"]
    }],
    "uiManifest": [{"componentId": "report-viewer", "artifactRef": "${id}-report", "priority": 1}],
    "executionUnits": [{
        "id": "t097-${id}",
        "status": "done",
        "tool": "agentserver.generated.python",
        "workEvidence": work_evidence,
        "guidanceDecisions": guidance_decisions
    }],
    "artifacts": [{
        "id": "${id}-report",
        "type": "research-report",
        "schema": {"type": "object"},
        "data": {"markdown": f"# T097 ${id}\n\nMode {mode} preserved runner refs, UI state, and WorkEvidence."},
        "workEvidence": work_evidence
    }],
    "workEvidence": work_evidence
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
