import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { SciForgeSkillDomain } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-general-work-matrix-'));
const seenDomains = new Set<string>();

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

expected = request.get("expectedArtifacts") or ["runtime-artifact"]

def artifact_for(kind):
    if kind == "research-report":
        return {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": request.get("skillId", "agentserver"),
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work-matrix"},
            "data": {
                "markdown": "# Agent report\n\nGenerated from a multi-turn SciForge request.",
                "sections": [{"title": "Summary", "content": "The generated task completed the requested report."}]
            }
        }
    if kind == "paper-list":
        return {
            "id": "paper-list",
            "type": "paper-list",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work-matrix"},
            "data": {"papers": [{"id": "arxiv:2604.00002", "title": "Agent systems", "url": "https://arxiv.org/abs/2604.00002"}]}
        }
    if kind == "structure-summary":
        return {
            "id": "structure-summary",
            "type": "structure-summary",
            "producerScenario": "structure-exploration",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work-matrix"},
            "data": {"structureId": "1A3N", "summary": "Generated structure summary."}
        }
    if kind == "omics-differential-expression":
        return {
            "id": "omics-differential-expression",
            "type": "omics-differential-expression",
            "producerScenario": "omics-differential-exploration",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work-matrix"},
            "data": {"rows": [{"gene": "KRAS", "log2FoldChange": 1.4, "padj": 0.02}]}
        }
    if kind == "knowledge-graph":
        return {
            "id": "knowledge-graph",
            "type": "knowledge-graph",
            "producerScenario": "biomedical-knowledge-graph",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work-matrix"},
            "data": {"nodes": [{"id": "TP53"}, {"id": "EGFR"}], "edges": [{"source": "TP53", "target": "EGFR", "type": "evidence"}]}
        }
    return {
        "id": kind,
        "type": kind,
        "producerScenario": "agentserver",
        "schemaVersion": "1",
        "metadata": {"source": "mock-agentserver-general-work-matrix"},
        "data": {"status": "generated"}
    }

component_for = {
    "research-report": "report-viewer",
    "paper-list": "paper-card-list",
    "structure-summary": "structure-viewer",
    "omics-differential-expression": "point-set-viewer",
    "knowledge-graph": "graph-viewer",
}

artifacts = [artifact_for(kind) for kind in expected]
ui_manifest = [
    {"componentId": component_for.get(kind, "unknown-artifact-inspector"), "artifactRef": kind, "priority": index + 1}
    for index, kind in enumerate(expected)
]

payload = {
    "message": "AgentServer generated a coordinated multi-artifact task.",
    "confidence": 0.87,
    "claimType": "evidence-summary",
    "evidenceLevel": "experimental",
    "reasoningTrace": "Generated task handled multi-turn context and expected artifacts.",
    "claims": [{"text": "The open-ended task was routed to AgentServer generation.", "confidence": 0.87, "evidenceLevel": "experimental"}],
    "uiManifest": ui_manifest,
    "executionUnits": [{"id": "agentserver-general-work-matrix", "status": "done", "tool": "agentserver.generated.python"}],
    "artifacts": artifacts
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'matrix-session', status: 'active' },
        operationalGuidance: { summary: ['context available'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy' },
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
  const text = typeof input.text === 'string' ? input.text : '';
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const skillDomain = typeof metadata.skillDomain === 'string' ? metadata.skillDomain : 'unknown';
  seenDomains.add(skillDomain);
  assert.match(text, /Recent multi-turn conversation|recentConversation|继续|report|报告/i);
  assert.match(text, /expectedArtifactTypes|research-report/i);
  const result = {
    ok: true,
    data: {
      run: {
        id: `mock-agentserver-${skillDomain}-run`,
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: `.sciforge/tasks/${skillDomain}-general-work.py`, language: 'python', content: generatedTask }],
            entrypoint: { language: 'python', path: `.sciforge/tasks/${skillDomain}-general-work.py` },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/<domain>-general-work.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: `Generated ${skillDomain} multi-turn work task.`,
          },
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

const cases: Array<{
  domain: SciForgeSkillDomain;
  prompt: string;
  expected: string[];
  components: string[];
}> = [
  {
    domain: 'literature',
    prompt: '帮我搜索arxiv上最新的agent论文，阅读并总结成报告',
    expected: ['paper-list', 'research-report'],
    components: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
  },
  {
    domain: 'structure',
    prompt: '继续分析PDB 1A3N的结构和关键残基，生成结构总结和系统性报告',
    expected: ['structure-summary', 'research-report'],
    components: ['structure-viewer', 'report-viewer', 'execution-unit-table'],
  },
  {
    domain: 'omics',
    prompt: '继续基于表达矩阵做差异分析，解释关键基因并写成报告',
    expected: ['omics-differential-expression', 'research-report'],
    components: ['point-set-viewer', 'matrix-viewer', 'report-viewer'],
  },
  {
    domain: 'knowledge',
    prompt: '继续查询TP53和EGFR相关知识，生成知识图谱和证据报告',
    expected: ['knowledge-graph', 'research-report'],
    components: ['graph-viewer', 'report-viewer', 'execution-unit-table'],
  },
];

try {
  for (const item of cases) {
    const result = await runWorkspaceRuntimeGateway({
      skillDomain: item.domain,
      prompt: item.prompt,
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      expectedArtifactTypes: item.expected,
      selectedComponentIds: item.components,
      uiState: {
        freshTaskGeneration: true,
        expectedArtifactTypes: item.expected,
        selectedComponentIds: item.components,
        recentConversation: [
          `user: ${item.prompt}`,
          'assistant: I will continue from prior context and produce complete artifacts.',
        ],
      },
      artifacts: [],
    });

    for (const artifactType of item.expected) {
      assert.ok(result.artifacts.some((artifact) => artifact.type === artifactType), `${item.domain} missing ${artifactType}`);
    }
    assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.generated.python'));
    assert.match(String(result.reasoningTrace), /AgentServer generation run/);
  }

  assert.deepEqual([...seenDomains].sort(), cases.map((item) => item.domain).sort());
  console.log('[ok] multi-scenario multi-turn work routes through AgentServer generation and emits complete artifacts');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
