import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const AGENT_BACKENDS = ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw'] as const;
type AgentBackend = typeof AGENT_BACKENDS[number];

const expectedArtifacts = ['omics-differential-expression', 'research-report'];
const selectedComponents = ['umap-viewer', 'data-table', 'report-viewer', 'execution-unit-table', 'notebook-timeline'];
const requestsByBackend = new Map<AgentBackend, Array<{ text: string; purpose: string }>>();

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
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
  assert.equal(metadata.skillDomain, 'omics');

  const text = typeof input.text === 'string' ? input.text : '';
  const purpose = typeof metadata.purpose === 'string' ? metadata.purpose : 'unknown';
  const seen = requestsByBackend.get(backend) ?? [];
  const round = seen.length + 1;
  assertPromptContract(text, round);
  requestsByBackend.set(backend, [...seen, { text, purpose }]);

  if (round === 1 || round === 2) {
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: `mock-${backend}-round-${round}`,
          status: 'completed',
          output: {
            result: {
              taskFiles: [{
                path: `.bioagent/tasks/${backend}-round-${round}.py`,
                language: 'python',
                content: generatedTask(backend, round),
              }],
              entrypoint: { language: 'python', path: `.bioagent/tasks/${backend}-round-${round}.py` },
              environmentRequirements: { language: 'python' },
              validationCommand: `python .bioagent/tasks/${backend}-round-${round}.py <input> <output>`,
              expectedArtifacts,
              patchSummary: `${backend} generated complex round ${round} task.`,
            },
          },
        },
      },
    });
    return;
  }

  if (round === 3) {
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: `mock-${backend}-round-3-direct`,
          status: 'completed',
          output: { result: directContextPayload(backend) },
        },
      },
    });
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
    const workspace = await mkdtemp(join(tmpdir(), `bioagent-backend-matrix-${backend}-`));
    const sessionId = `backend-matrix-${backend}`;
    const round1 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 1: build a Tabula Sapiens multi-organ scRNA atlas plan with QC, integration, clustering, marker genes, annotation, and composition comparison.',
      expectedArtifactTypes: ['runtime-artifact', ...expectedArtifacts],
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 1 Tabula Sapiens atlas plan',
        recentConversation: ['user: start Tabula Sapiens atlas benchmark'],
        expectedArtifactTypes: ['runtime-artifact', ...expectedArtifacts],
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
      },
      artifacts: [],
    });
    assertBackendOutput(round1, backend, 1, ['runtime-artifact', ...expectedArtifacts]);

    const round2 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 2: continue from previous artifacts and refs, add marker gene table, cross-organ cell composition, and a systematic report.',
      expectedArtifactTypes: expectedArtifacts,
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 2 continue previous Tabula Sapiens atlas refs',
        recentConversation: [
          'user: start Tabula Sapiens atlas benchmark',
          `assistant: ${round1.message}`,
          'user: continue from previous artifacts and refs',
        ],
        recentExecutionRefs: round1.executionUnits,
        expectedArtifactTypes: expectedArtifacts,
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
      },
      artifacts: round1.artifacts,
    });
    assertBackendOutput(round2, backend, 2, expectedArtifacts);

    const round3 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      agentBackend: backend,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: 'Round 3: answer from existing context only, read previous artifacts and refs, do not rerun, and summarize whether the complex task is complete.',
      expectedArtifactTypes: expectedArtifacts,
      selectedComponentIds: selectedComponents,
      uiState: {
        sessionId,
        currentPrompt: 'Round 3 summarize existing context without rerun',
        recentConversation: [
          'user: start Tabula Sapiens atlas benchmark',
          `assistant: ${round1.message}`,
          'user: continue from previous artifacts and refs',
          `assistant: ${round2.message}`,
          'user: answer from existing context only; do not rerun',
        ],
        recentExecutionRefs: round2.executionUnits,
        expectedArtifactTypes: expectedArtifacts,
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true,
      },
      artifacts: [...round2.artifacts, ...round1.artifacts],
    });
    assertBackendOutput(round3, backend, 3, expectedArtifacts);
    assert.ok(round3.artifacts.some((artifact) =>
      artifact.type === 'omics-differential-expression'
      && isRecord(artifact.metadata)
      && artifact.metadata.reusedForContextAnswer === true
    ), `${backend} round 3 should reuse previous omics artifact for a direct context answer`);
  }

  for (const backend of AGENT_BACKENDS) {
    const seen = requestsByBackend.get(backend) ?? [];
    assert.equal(seen.length, 3, `${backend} should complete three AgentServer turns`);
    assert.ok(seen.every((entry) => entry.purpose === 'workspace-task-generation'), `${backend} should use generation dispatch for each turn`);
  }
  console.log('[ok] all AgentServer backends handle complex three-round continuation with task generation and direct context answers');
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

expected = request.get("expectedArtifacts") or ["omics-differential-expression", "research-report"]
prompt = request.get("prompt", "")

def artifact_for(kind):
    if kind == "runtime-artifact":
        return {
            "id": f"{backend}-atlas-plan",
            "type": "runtime-artifact",
            "producerScenario": "omics",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "rows": [
                    {"step": "QC", "status": "planned"},
                    {"step": "integration", "status": "planned"},
                    {"step": "marker genes", "status": "planned"},
                    {"step": "cross-organ composition", "status": "planned"}
                ]
            }
        }
    if kind == "omics-differential-expression":
        return {
            "id": "omics-differential-expression",
            "type": "omics-differential-expression",
            "producerScenario": "omics",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "rows": [
                    {"feature": "Tabula Sapiens marker genes", "status": "done", "backend": backend},
                    {"feature": "cross-organ composition", "status": "done", "backend": backend},
                    {"feature": "cell type annotation", "status": "done", "backend": backend}
                ]
            }
        }
    if kind == "research-report":
        return {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "omics",
            "schemaVersion": "1",
            "metadata": {"source": "backend-matrix", "backend": backend, "round": round_no},
            "data": {
                "markdown": f"# {backend} round {round_no} report\n\nTabula Sapiens continuation used previous context, marker genes, annotation, and composition comparison.\n\nPrompt: {prompt[:200]}",
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
    "runtime-artifact": "data-table",
    "omics-differential-expression": "umap-viewer",
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
    message: `${backend} round 3 answered from previous artifacts and refs without rerun; the complex Tabula Sapiens task is complete enough for reporting.`,
    confidence: 0.83,
    claimType: 'evidence-summary',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: `${backend} read previous artifacts, prior refs, and current session context before returning a direct context answer.`,
    claims: [{
      text: `${backend} can continue a complex multi-turn task and answer from existing context.`,
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
        markdown: `${backend} direct context report: previous artifacts and refs were enough; no rerun was needed.`,
        sections: [{ title: 'Direct context answer', content: `${backend} preserved the multi-turn context.` }],
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
  assert.match(text, /Tabula Sapiens|scRNA|marker genes|composition/i);
  assert.match(text, /expectedArtifactTypes|omics-differential-expression|research-report/i);
  assert.match(text, /selectedComponentIds|report-viewer|execution-unit-table/i);
  assert.match(text, /recentConversation|priorAttempts/i);
  if (round > 1) {
    assert.match(text, /previous artifacts|recentExecutionRefs|artifacts|refs|do not rerun|context/i);
  }
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

function sendAgentServerRun(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  requestUrl: string | undefined,
  result: Record<string, unknown>,
) {
  if (requestUrl === '/api/agent-server/runs/stream') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ result }) + '\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
