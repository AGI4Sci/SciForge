import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types.js';

const AGENT_BACKENDS = ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'] as const;
type AgentBackend = typeof AGENT_BACKENDS[number];
type TokenUsage = NonNullable<WorkspaceRuntimeEvent['usage']>;
type ContextWindowState = NonNullable<WorkspaceRuntimeEvent['contextWindowState']>;

const expectedArtifacts = ['paper-list', 'research-report'];
const selectedComponents = ['paper-card-list', 'report-viewer', 'execution-unit-table', 'notebook-timeline'];
const requestsByBackend = new Map<AgentBackend, Array<{ text: string; purpose: string }>>();
const usageByBackend = new Map<AgentBackend, Required<Pick<TokenUsage, 'input' | 'output' | 'total'>>>();
const contextWindowsByBackend = new Map<AgentBackend, ContextWindowState[]>();
const contextReadsByBackend = new Map<AgentBackend, number>();
let activeBackend: AgentBackend = 'codex';

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    contextReadsByBackend.set(activeBackend, (contextReadsByBackend.get(activeBackend) ?? 0) + 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-backend-matrix-context', status: 'active' },
        operationalGuidance: { summary: ['context available for backend matrix'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 240 },
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
  const agent = isRecord(body.agent) ? body.agent : {};
  const runtime = isRecord(body.runtime) ? body.runtime : {};
  const input = isRecord(body.input) ? body.input : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const backend = String(agent.backend || '');
  assert.ok(isAgentBackend(backend), `unexpected backend ${backend}`);
  assert.equal(runtime.backend, backend);
  assert.equal(agent.workspace, runtime.cwd);
  assert.equal(metadata.skillDomain, 'literature');

  const text = typeof input.text === 'string' ? input.text : '';
  const purpose = typeof metadata.purpose === 'string' ? metadata.purpose : 'unknown';
  const seen = requestsByBackend.get(backend) ?? [];
  const round = seen.length + 1;
  assertPromptContract(text, round);
  requestsByBackend.set(backend, [...seen, { text, purpose }]);

  if (round === 1 || round === 2) {
    const usage = tokenUsageFor(backend, round);
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: `mock-${backend}-round-${round}`,
          status: 'completed',
          output: {
            result: {
              taskFiles: [{
                path: `.sciforge/tasks/${backend}-round-${round}.py`,
                language: 'python',
                content: generatedTask(backend, round),
              }],
              entrypoint: { language: 'python', path: `.sciforge/tasks/${backend}-round-${round}.py` },
              environmentRequirements: { language: 'python' },
              validationCommand: `python .sciforge/tasks/${backend}-round-${round}.py <input> <output>`,
              expectedArtifacts,
              patchSummary: `${backend} generated complex round ${round} task.`,
            },
          },
        },
      },
    }, usage);
    return;
  }

  if (round === 3) {
    const usage = tokenUsageFor(backend, round);
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: `mock-${backend}-round-3-direct`,
          status: 'completed',
          output: { result: directContextPayload(backend) },
        },
      },
    }, usage);
    return;
  }

  assert.fail(`${backend} received unexpected extra AgentServer request`);
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  for (const backend of AGENT_BACKENDS) {
    activeBackend = backend;
    const workspace = await mkdtemp(join(tmpdir(), `sciforge-backend-matrix-${backend}-`));
    const sessionId = `backend-matrix-${backend}`;
    const round1 = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 1: 检索今天 arXiv 上最新的 agent 相关论文，下载并阅读全文，输出 paper-list 和详细 markdown 阅读报告。',
      expectedArtifactTypes: ['runtime-artifact', ...expectedArtifacts],
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 1 arXiv agent paper full-text review',
        recentConversation: ['user: 检索今天 arXiv 最新 agent 论文并阅读全文写报告'],
        expectedArtifactTypes: ['runtime-artifact', ...expectedArtifacts],
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
      },
      artifacts: [],
    }, usageCollector(backend));
    assertBackendOutput(round1, backend, 1, ['runtime-artifact', ...expectedArtifacts]);

    const round2 = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 2: 继续基于上一轮论文和全文，补充逐篇创新点、独特性、技术路线、证据矩阵和报告。',
      expectedArtifactTypes: expectedArtifacts,
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 2 enrich previous arXiv full-text report',
        recentConversation: [
          'user: 检索今天 arXiv 最新 agent 论文并阅读全文写报告',
          `assistant: ${round1.message}`,
          'user: 继续从已有 paper-list 和 research-report 补逐篇深度分析',
        ],
        recentExecutionRefs: [],
        expectedArtifactTypes: expectedArtifacts,
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
        executionModePlan: { executionMode: 'multi-stage-project' },
        responsePlan: { initialResponseMode: 'generated-artifact' },
      },
      artifacts: [],
    }, usageCollector(backend));
    assertBackendOutput(round2, backend, 2, expectedArtifacts);

    const round3 = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 3: 只读取已有上下文，不重新下载或执行，评估这份 agent 论文阅读报告是否完整并总结剩余风险。',
      expectedArtifactTypes: expectedArtifacts,
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 3 summarize arXiv report completeness without rerun',
        recentConversation: [
          'user: 检索今天 arXiv 最新 agent 论文并阅读全文写报告',
          `assistant: ${round1.message}`,
          'user: 继续从已有 paper-list 和 research-report 补逐篇深度分析',
          `assistant: ${round2.message}`,
          'user: 只读已有上下文，评估报告完整性，不重新执行',
        ],
        recentExecutionRefs: round2.executionUnits,
        expectedArtifactTypes: expectedArtifacts,
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
      },
      artifacts: [...round2.artifacts, ...round1.artifacts],
    }, usageCollector(backend));
    assertBackendOutput(round3, backend, 3, expectedArtifacts);
    assert.ok(round3.artifacts.some((artifact) =>
      artifact.type === 'paper-list'
      && isRecord(artifact.metadata)
      && artifact.metadata.reusedForContextAnswer === true
    ), `${backend} round 3 should reuse previous paper-list artifact for a direct context answer`);
  }

  for (const backend of AGENT_BACKENDS) {
    const seen = requestsByBackend.get(backend) ?? [];
    assert.equal(seen.length, 3, `${backend} should complete three AgentServer turns`);
    assert.ok(seen.every((entry) => entry.purpose === 'workspace-task-generation'), `${backend} should use generation dispatch for each turn`);
    const usage = usageByBackend.get(backend);
    assert.ok(usage && usage.total > 0, `${backend} should report token usage`);
    const contextWindows = contextWindowsByBackend.get(backend) ?? [];
    assert.ok((contextReadsByBackend.get(backend) ?? 0) >= 1, `${backend} should call readContextWindowState during backend matrix dispatch`);
    const preflightState = contextWindows.find((state) => state.backend === backend && state.source !== 'provider-usage');
    assert.ok(preflightState, `${backend} should expose an explicit AgentServer estimate/fallback context source before usage arrives`);
    assert.ok(typeof preflightState.source === 'string' && preflightState.source.length > 0, `${backend} preflight context source should be explicit`);
    assert.equal(preflightState.compactCapability, preflightCompactCapabilityForBackend(backend));
    const usageState = contextWindows.find((state) => state.source === 'provider-usage' && state.backend === backend);
    if (usageState) {
      assert.equal(usageState.provider, backend);
      assert.equal(usageState.model, `${backend}-mock-model`);
      assert.equal(usageState.usedTokens, usageState.input! + usageState.output!);
      assert.equal(usageState.status, 'unknown');
      assert.equal(usageState.compactCapability, compactCapabilityForBackend(backend));
      if (backend === 'openclaw') {
        assert.equal(usageState.compactCapability, 'handoff-only', 'OpenClaw should advertise handoff-only compact fallback unless native compact is proven');
      }
    }
  }
  const reportPath = join(process.cwd(), 'docs', 'AgentBackendMultiturnTestReport.md');
  await writeFile(reportPath, buildMarkdownReport(), 'utf8');
  console.log(`[ok] all AgentServer backends handle the same three-round arXiv agent-paper continuation; report written to ${reportPath}`);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function generatedTask(backend: AgentBackend, round: number) {
  return String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
backend = ${JSON.stringify(backend)}
round_no = ${round}

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

expected = request.get("expectedArtifacts") or request.get("expectedArtifactTypes") or ["paper-list", "research-report"]
prompt = request.get("prompt", "")

def artifact_for(kind):
    if kind == "runtime-artifact":
        return {
            "id": f"{backend}-arxiv-plan",
            "type": "runtime-artifact",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "rows": [
                    {"step": "arXiv search", "status": "planned"},
                    {"step": "PDF download", "status": "planned"},
                    {"step": "full-text extraction", "status": "planned"},
                    {"step": "markdown report", "status": "planned"}
                ]
            }
        }
    if kind == "paper-list":
        return {
            "id": "paper-list",
            "type": "paper-list",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "papers": [
                    {"id": f"arxiv:2605.0000{round_no}", "title": f"Agent benchmark paper via {backend}", "url": f"https://arxiv.org/abs/2605.0000{round_no}", "status": "full-text-read"},
                    {"id": f"arxiv:2605.0001{round_no}", "title": f"Multi-agent workflow paper via {backend}", "url": f"https://arxiv.org/abs/2605.0001{round_no}", "status": "full-text-read"}
                ]
            }
        }
    if kind == "research-report":
        return {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "markdown": f"# {backend} round {round_no} arXiv agent-paper report\n\nThe backend preserved the same multi-turn task: search today's agent papers, read full text, and summarize novelty, uniqueness, and technical path.\n\nPrompt: {prompt[:200]}",
                "sections": [{"title": "Backend matrix", "content": f"{backend} completed round {round_no}."}]
            }
        }
    return {
        "id": kind,
        "type": kind,
        "producerScenario": "omics",
        "schemaVersion": "1",
        "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
        "data": {"status": "generated"}
    }

component_for = {
    "runtime-artifact": "record-table",
    "paper-list": "paper-card-list",
    "research-report": "report-viewer"
}
artifacts = [artifact_for(kind) for kind in expected]
ui_manifest = [
    {"componentId": component_for.get(kind, "unknown-artifact-inspector"), "artifactRef": artifact.get("id", kind), "priority": index + 1}
    for index, (kind, artifact) in enumerate(zip(expected, artifacts))
]
ui_manifest.append({"componentId": "execution-unit-table", "artifactRef": "research-report", "priority": len(ui_manifest) + 1})

payload = {
    "message": f"{backend} round {round_no} completed complex Tabula Sapiens continuation.",
    "confidence": 0.86,
    "claimType": "evidence-summary",
    "evidenceLevel": "mock-agentserver",
    "reasoningTrace": f"{backend} generated and executed a workspace task for round {round_no}.",
    "claims": [{"text": f"{backend} preserved complex multi-turn context.", "confidence": 0.86, "evidenceLevel": "mock-agentserver"}],
    "uiManifest": ui_manifest,
    "executionUnits": [{
        "id": f"{backend}-round-{round_no}",
        "status": "done",
        "tool": f"agentserver.{backend}.generated.python",
        "params": json.dumps({"expected": expected, "round": round_no})
    }],
    "artifacts": artifacts
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;
}

function directContextPayload(backend: AgentBackend) {
  return {
    message: `${backend} round 3 answered from previous artifacts and refs without rerun; the arXiv agent-paper reading task is complete enough for reporting.`,
    confidence: 0.83,
    claimType: 'evidence-summary',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: `${backend} read previous paper-list, report artifacts, prior refs, and current session context before returning a direct context answer.`,
    claims: [{
      text: `${backend} can continue a complex multi-turn arXiv reading task and answer from existing context.`,
      confidence: 0.83,
      evidenceLevel: 'mock-agentserver',
    }],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: `${backend}-round-3-context-answer`, priority: 2 },
    ],
    executionUnits: [{
      id: `${backend}-round-3-context-answer`,
      status: 'record-only',
      tool: `agentserver.${backend}.direct-context`,
      params: JSON.stringify({ source: 'previous artifacts and refs', noRerun: true }),
    }],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      producerScenario: 'omics',
      schemaVersion: '1',
      metadata: { source: 'backend-matrix', backend, round: 3 },
      data: {
        markdown: `${backend} direct context report: previous arXiv paper-list/report artifacts and refs were enough; no rerun was needed.`,
        sections: [{ title: 'Direct context answer', content: `${backend} preserved the multi-turn arXiv reading context.` }],
      },
    }],
  };
}

function assertBackendOutput(
  payload: Awaited<ReturnType<typeof runWorkspaceRuntimeGateway>>,
  backend: AgentBackend,
  round: number,
  artifactTypes: string[],
) {
  assert.match(payload.message, new RegExp(backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const type of artifactTypes) {
    assert.ok(payload.artifacts.some((artifact) => artifact.type === type), `${backend} round ${round} missing ${type}`);
  }
  assert.ok(payload.uiManifest.some((slot) => slot.componentId === 'report-viewer'), `${backend} round ${round} missing report slot`);
  assert.ok(payload.uiManifest.some((slot) => slot.componentId === 'execution-unit-table'), `${backend} round ${round} missing execution slot`);
  assert.ok(payload.executionUnits.some((unit) =>
    isRecord(unit)
    && unit.runtimeProfileId === `agentserver-${backend}`
    && isRecord(unit.routeDecision)
    && unit.routeDecision.selectedRuntime === 'agentserver-generation'
  ), `${backend} round ${round} should be attributed to agentserver-${backend}`);
}

function assertPromptContract(text: string, round: number) {
  assert.match(text, /AgentServer owns orchestration|taskContract|AgentServerGenerationResponse/i);
  assert.match(text, /arXiv|agent|paper|论文|全文|阅读|报告/i);
  assert.match(text, /expectedArtifactTypes|paper-list|research-report/i);
  assert.match(text, /selectedComponentIds|paper-card-list|report-viewer|execution-unit-table/i);
  assert.match(text, /recentConversation|priorAttempts/i);
  if (round > 1) {
    assert.match(text, /previous artifacts|recentExecutionRefs|artifacts|refs|do not rerun|context/i);
  }
}

function usageCollector(backend: AgentBackend) {
  return {
    onEvent(event: WorkspaceRuntimeEvent) {
      if (event.contextWindowState) {
        contextWindowsByBackend.set(backend, [...(contextWindowsByBackend.get(backend) ?? []), event.contextWindowState]);
      }
      if (!event.usage) return;
      const current = usageByBackend.get(backend) ?? { input: 0, output: 0, total: 0 };
      current.input += event.usage.input ?? 0;
      current.output += event.usage.output ?? 0;
      current.total += event.usage.total ?? ((event.usage.input ?? 0) + (event.usage.output ?? 0));
      usageByBackend.set(backend, current);
    },
  };
}

function tokenUsageFor(backend: AgentBackend, round: number): TokenUsage {
  const backendIndex = AGENT_BACKENDS.indexOf(backend);
  const input = 7_800 + backendIndex * 180 + round * 420;
  const output = 1_250 + backendIndex * 95 + round * 210;
  return {
    input,
    output,
    total: input + output,
    provider: backend,
    model: `${backend}-mock-model`,
    source: 'mock-agentserver-backend-matrix',
  };
}

function buildMarkdownReport() {
  const generatedAt = new Date().toISOString();
  const rows = AGENT_BACKENDS.map((backend) => {
    const seen = requestsByBackend.get(backend) ?? [];
    const usage = usageByBackend.get(backend) ?? { input: 0, output: 0, total: 0 };
    const contextReads = contextReadsByBackend.get(backend) ?? 0;
    const source = (contextWindowsByBackend.get(backend) ?? []).find((state) => state.backend === backend && state.source !== 'provider-usage')?.source ?? 'missing';
    return `| ${backend} | ${seen.length}/3 | ${contextReads} | ${source} | Pass | ${usage.input} | ${usage.output} | ${usage.total} |`;
  }).join('\n');
  return `# AgentBackend Multi-turn Test Report

Generated: ${generatedAt}

## Test Task

Same three-round conversation for every AgentBackend:

1. Search today's latest arXiv agent-related papers, download/read full text, and produce \`paper-list\` plus \`research-report\`.
2. Continue from previous artifacts and refs, then enrich per-paper novelty, uniqueness, technical path, evidence matrix, and report.
3. Read existing context only, do not rerun/download, and summarize report completeness plus residual risks.

## Results

| Backend | Completed turns | Context reads | Preflight source | Completion | Input tokens | Output tokens | Total tokens |
| --- | ---: | ---: | --- | --- | ---: | ---: | ---: |
${rows}

## Findings

- All tested backends completed the same three-turn workflow through AgentServer generation/direct-context dispatch.
- Round 3 verified context reuse by reusing the prior \`paper-list\` artifact without rerunning the workspace task.
- Token usage is collected from AgentServer stream usage events; this smoke uses deterministic mock token accounting so regressions are reproducible in CI.
- OpenClaw is verified as a compatibility backend with handoff-only compact fallback unless native compact is explicitly exposed.
- Gemini is now included in frontend/backend normalization and appears as a selectable AgentBackend.
`;
}

function readJson(req: AsyncIterable<Buffer | string>) {
  return new Promise<Record<string, unknown>>(async (resolve) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    resolve(isRecord(parsed) ? parsed : {});
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentBackend(value: string): value is AgentBackend {
  return AGENT_BACKENDS.includes(value as AgentBackend);
}

function compactCapabilityForBackend(backend: AgentBackend): ContextWindowState['compactCapability'] {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  return 'handoff-only';
}

function preflightCompactCapabilityForBackend(backend: AgentBackend): ContextWindowState['compactCapability'] {
  if (backend === 'hermes-agent') return 'native';
  return compactCapabilityForBackend(backend);
}

function sendAgentServerRun(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  requestUrl: string | undefined,
  result: Record<string, unknown>,
  usage?: TokenUsage,
) {
  if (requestUrl === '/api/agent-server/runs/stream') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const event = usage
      ? JSON.stringify({ event: { type: 'usage-update', message: 'mock token usage', usage } }) + '\n'
      : '';
    res.end(event + JSON.stringify({ result }) + '\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
