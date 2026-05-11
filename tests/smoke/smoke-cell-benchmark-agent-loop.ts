import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { recommendScenarioElements } from '@sciforge/scenario-core/scenario-element-compiler';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cell-benchmark-agent-loop-'));
const seenPrompts: Array<{ purpose: string; text: string }> = [];

const expectedArtifacts = ['omics-differential-expression', 'research-report'];
const selectedComponents = ['point-set-viewer', 'record-table', 'report-viewer', 'execution-unit-table', 'notebook-timeline'];

const goodTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

prompt = request.get("prompt", "")
expected = request.get("expectedArtifacts") or ["omics-differential-expression", "research-report"]

def report_text():
    return "\n".join([
        "# Cell benchmark report",
        "",
        f"Prompt: {prompt[:240]}",
        "",
        "- Complex single-cell workflow routed through AgentServer generation.",
        "- Recent conversation, selected UI components, expected artifacts, and prior attempts were preserved.",
        "- Missing real data would be reported as failed-with-reason instead of fabricated success.",
        "- Keywords covered: Tabula Sapiens, label transfer, scVelo RNA velocity, Perturb-seq, spatial cardiac niches, CITE-seq totalVI."
    ])

def artifact_for(kind):
    if kind == "research-report":
        return {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "cell-benchmark",
            "schemaVersion": "1",
            "metadata": {"source": "mock-cell-benchmark-agent-loop"},
            "data": {
                "markdown": report_text(),
                "sections": [{"title": "Benchmark", "content": "Complex single-cell workflow completed."}]
            }
        }
    if kind == "omics-differential-expression":
        return {
            "id": "omics-differential-expression",
            "type": "omics-differential-expression",
            "producerScenario": "cell-benchmark",
            "schemaVersion": "1",
            "metadata": {
                "source": "mock-cell-benchmark-agent-loop",
                "batch mixing": "checked",
                "label transfer": "checked",
                "guide assignment": "checked",
                "perturbation signature": "checked",
                "spatial neighborhood": "checked",
                "RNA/ADT modality": "checked"
            },
            "data": {
                "rows": [
                    {"feature": "QC", "status": "planned", "detail": "filter cells, genes, mitochondrial fraction"},
                    {"feature": "integration", "status": "planned", "detail": "batch correction or reference mapping"},
                    {"feature": "velocity", "status": "planned", "detail": "spliced/unspliced, stream, latent time"},
                    {"feature": "report", "status": "done", "detail": "systematic report artifact emitted"}
                ]
            }
        }
    return {
        "id": kind,
        "type": kind,
        "producerScenario": "cell-benchmark",
        "schemaVersion": "1",
        "metadata": {"source": "mock-cell-benchmark-agent-loop"},
        "data": {"status": "generated"}
    }

component_for = {
    "omics-differential-expression": "point-set-viewer",
    "research-report": "report-viewer",
    "runtime-artifact": "unknown-artifact-inspector",
}

artifacts = [artifact_for(kind) for kind in expected]
ui_manifest = [
    {"componentId": component_for.get(kind, "unknown-artifact-inspector"), "artifactRef": kind, "priority": index + 1}
    for index, kind in enumerate(expected)
]
ui_manifest.append({"componentId": "execution-unit-table", "artifactRef": "omics-differential-expression", "priority": len(ui_manifest) + 1})

payload = {
    "message": "Generated complex cell benchmark workspace task.",
    "confidence": 0.84,
    "claimType": "evidence-summary",
    "evidenceLevel": "mock-runtime",
    "reasoningTrace": "Mock AgentServer generated a coordinated single-cell task from multi-turn context.",
    "claims": [{"text": "Complex single-cell work routed through AgentServer generation.", "confidence": 0.84, "evidenceLevel": "mock-runtime"}],
    "uiManifest": ui_manifest,
    "executionUnits": [{
        "id": "cell-benchmark-generated-task",
        "status": "done",
        "tool": "agentserver.generated.python",
        "params": json.dumps({"prompt": prompt[:160], "expected": expected})
    }],
    "artifacts": artifacts
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

const schemaBadTask = String.raw`
import json
import sys

output_path = sys.argv[2]
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump({"message": "schema-bad: missing ToolPayload arrays"}, handle)
`;

const cases = [
  {
    name: 'Tabula Sapiens atlas',
    prompt: '创建一个 Tabula Sapiens 多器官 scRNA 图谱复现场景，要求完成 QC、整合、聚类、marker gene、细胞类型注释和跨器官组成比较。',
    continuation: '继续 Tabula Sapiens atlas，读取上一轮 artifact 和日志，补齐 marker gene 表、跨器官细胞组成比较和系统性报告。',
    keywords: /Tabula Sapiens|atlas|scRNA|marker/i,
    schemaBadFirstRun: true,
  },
  {
    name: 'single-cell integration / label transfer',
    prompt: '我要复现 Comprehensive integration of single-cell data，做跨数据集整合、Seurat anchors、batch mixing 评估、reference mapping 和 label transfer。',
    continuation: '继续 single-cell integration / label transfer，补 batch mixing 指标和 label transfer 质量评估报告。',
    keywords: /single-cell|integration|label transfer|batch mixing|Seurat/i,
  },
  {
    name: 'scVelo RNA velocity',
    prompt: '帮我做 scVelo RNA velocity 复现场景：读取 spliced/unspliced 矩阵，生成 velocity stream、latent time、driver genes 和模型比较。',
    continuation: '继续 scVelo RNA velocity，基于刚才结果补 driver genes、latent time 解释和模型比较报告。',
    keywords: /scVelo|RNA velocity|spliced|unspliced|latent time|driver genes/i,
  },
  {
    name: 'Perturb-seq',
    prompt: '复现 Perturb-seq 单细胞扰动分析，完成 guide assignment、扰动 signature、基因模块和通路富集。',
    continuation: '继续 Perturb-seq，读取上一轮失败或输出，补 guide assignment、perturbation signature 和通路富集报告。',
    keywords: /Perturb-seq|guide assignment|perturbation signature|通路富集/i,
  },
  {
    name: 'spatial cardiac niches',
    prompt: '复现 spatial human cardiac niches 空间转录组分析，完成细胞映射、空间邻域、niche 分析和系统性报告。',
    continuation: '继续 spatial cardiac niches，补 spatial neighborhood、niche composition、细胞映射质量和系统性报告。',
    keywords: /spatial|cardiac|niche|neighborhood|空间/i,
  },
  {
    name: 'CITE-seq totalVI',
    prompt: '复现 CITE-seq totalVI 联合建模，整合 RNA 和 ADT，输出联合 embedding、模态权重、细胞类型注释和报告。',
    continuation: '继续 CITE-seq totalVI，补 RNA/ADT modality 权重、联合 embedding 解释和细胞类型注释报告。',
    keywords: /CITE-seq|totalVI|RNA|ADT|modality|embedding/i,
  },
];

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    sendContextSnapshot(res, 'mock-cell-benchmark-context');
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const agent = isRecord(body.agent) ? body.agent : {};
  const input = isRecord(body.input) ? body.input : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const text = typeof input.text === 'string' ? input.text : '';
  const purpose = typeof metadata.purpose === 'string' ? metadata.purpose : 'unknown';
  seenPrompts.push({ purpose, text });

  assertPromptContract(text, purpose);

  if (purpose === 'workspace-task-repair') {
    const workspacePath = typeof agent.workspace === 'string' ? agent.workspace : workspace;
    const codeRef = typeof metadata.codeRef === 'string' ? metadata.codeRef : '';
    assert.match(codeRef, /^\.sciforge\/(?:sessions\/.+\/)?tasks\//, `repair codeRef should point at generated task, got ${codeRef}`);
    assert.match(text, /schema-bad|schema validation|missing claims|priorAttempts|repairContext|failureReason/i);
    await writeFile(join(workspacePath, codeRef), goodTask);
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: 'mock-cell-benchmark-repair-run',
          status: 'completed',
          output: { result: 'Patched schema-bad cell benchmark task to emit a valid ToolPayload.' },
        },
      },
    });
    return;
  }

  if (/direct text bridge/i.test(text)) {
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: 'mock-cell-benchmark-direct-text',
          status: 'completed',
          output: {
            result: 'Research report: AgentServer returned direct text for a CITE-seq totalVI direct text bridge smoke. SciForge should preserve this as a report artifact and keep omics plus execution UI slots visible.',
          },
        },
      },
    });
    return;
  }

  const shouldReturnBadTask = /Tabula Sapiens/.test(text) && !seenPrompts.some((item) => item.purpose === 'workspace-task-repair');
  const taskIndex = seenPrompts.length;
  const taskContent = shouldReturnBadTask ? schemaBadTask : goodTask;
  sendAgentServerRun(res, req.url, {
    ok: true,
    data: {
      run: {
        id: `mock-cell-benchmark-${taskIndex}`,
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: `.sciforge/tasks/cell-benchmark-${taskIndex}.py`, language: 'python', content: taskContent }],
            entrypoint: { language: 'python', path: `.sciforge/tasks/cell-benchmark-${taskIndex}.py` },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/cell-benchmark.py <input> <output>',
            expectedArtifacts,
            patchSummary: shouldReturnBadTask
              ? 'Generated intentionally schema-bad task for repair smoke.'
              : 'Generated complex cell benchmark task.',
          },
        },
      },
    },
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  for (const item of cases) {
    const recommendation = recommendScenarioElements(item.prompt);
    assert.ok(recommendation.selectedSkillIds.includes('agentserver.generate.omics'), `${item.name} should select generated omics capability`);
    assert.ok(recommendation.selectedArtifactTypes.includes('research-report'), `${item.name} should request research-report`);
    assert.ok(recommendation.selectedArtifactTypes.includes('omics-differential-expression'), `${item.name} should request omics artifact`);

    const initial = await runCellCase(`${item.name} initial`, item.prompt, item.keywords, []);
    assertCellOutput(initial, `${item.name} initial`);
    if (item.schemaBadFirstRun) {
      assert.ok(initial.executionUnits.some((unit) => isRecord(unit) && unit.status === 'self-healed'), `${item.name} should self-heal schema-bad first run`);
      assert.match(String(initial.reasoningTrace), /AgentServer repair run|schema/i);
    }

    const continuation = await runCellCase(
      `${item.name} continuation`,
      item.continuation,
      item.keywords,
      initial.artifacts,
      [
        `user: ${item.prompt}`,
        `assistant: ${initial.message}`,
        `user: ${item.continuation}`,
      ],
    );
    assertCellOutput(continuation, `${item.name} continuation`);
    assert.match(String(continuation.reasoningTrace), /AgentServer generation run/);
  }

  const directText = await runCellCase(
    'direct text bridge',
    'direct text bridge CITE-seq totalVI: 返回自然语言报告，同时保持 research-report、omics-differential-expression 和 execution-unit-table slot。',
    /CITE-seq|totalVI|direct text/i,
    [],
  );
  assertCellOutput(directText, 'direct text bridge');
  assert.match(String(directText.reasoningTrace), /plain text|direct/i);

  const generationPrompts = seenPrompts.filter((item) => item.purpose === 'workspace-task-generation');
  const repairPrompts = seenPrompts.filter((item) => item.purpose === 'workspace-task-repair');
  assert.ok(generationPrompts.length >= cases.length + 1, 'cell benchmark should exercise generated AgentServer work across initial and bridge cases');
  assert.equal(repairPrompts.length, 1);
  console.log('[ok] complex cell benchmark tasks compile, repair, continue, and preserve AgentServer artifact/UI contracts');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

await runTabulaSapiensThreeRoundContinuationSmoke();

async function runCellCase(
  label: string,
  prompt: string,
  keywords: RegExp,
  artifacts: Array<Record<string, unknown>>,
  recentConversation = [
    `user: ${prompt}`,
    'assistant: 已生成第一轮 workspace task，等待继续分析、修复或补报告。',
    'user: 继续，读取上一轮 artifact、attempt history 和日志，不要伪造成功。',
  ],
) {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'omics',
    prompt,
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: expectedArtifacts,
    selectedComponentIds: selectedComponents,
    uiState: {
      freshTaskGeneration: true,
      forceAgentServerGeneration: true,
      executionModePlan: { executionMode: 'multi-stage-project' },
      responsePlan: { initialResponseMode: 'generated-artifact' },
      expectedArtifactTypes: expectedArtifacts,
      selectedComponentIds: selectedComponents,
      recentConversation,
    },
    artifacts: [],
  });
  assert.match(prompt, keywords, `${label} prompt should keep complex cell task keywords`);
  return result;
}

function assertPromptContract(text: string, purpose: string) {
  assert.match(text, /Recent multi-turn conversation|recentConversation|继续|上一轮|uiStateSummary/i);
  assert.match(text, /expectedArtifactTypes|research-report|omics-differential-expression/i);
  assert.match(text, /selectedComponentIds|report-viewer|execution-unit-table/i);
  assert.match(text, /priorAttempts|repairContext|workspaceRefs/i);
  assert.match(text, /Tabula Sapiens|label transfer|scVelo|Perturb-seq|spatial|CITE-seq|single-cell|RNA velocity|totalVI|单细胞/i);
  if (purpose === 'workspace-task-generation') {
    assert.match(text, /taskContract|AgentServerGenerationResponse/i);
  }
}

function assertCellOutput(payload: {
  artifacts: Array<Record<string, unknown>>;
  uiManifest: Array<Record<string, unknown>>;
  executionUnits: Array<Record<string, unknown>>;
}, label: string) {
  assert.ok(payload.artifacts.some((artifact) => artifact.type === 'omics-differential-expression'), `${label} missing omics artifact`);
  assert.ok(payload.artifacts.some((artifact) => artifact.type === 'research-report'), `${label} missing report artifact`);
  assert.ok(payload.uiManifest.some((slot) => slot.componentId === 'report-viewer'), `${label} missing report slot`);
  assert.ok(payload.uiManifest.some((slot) => slot.componentId === 'execution-unit-table'), `${label} missing execution slot`);
  assert.ok(payload.executionUnits.length > 0, `${label} missing execution units`);
  assert.ok(payload.executionUnits.every((unit) => {
    if (!isRecord(unit) || !isRecord(unit.routeDecision)) return false;
    return unit.routeDecision.selectedRuntime === 'agentserver-generation';
  }), `${label} should route through AgentServer generation`);
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

async function expandCompactedInputText(text: string, workspacePath: string) {
  const rawRef = text.match(/rawRef: ([^\n]+)/)?.[1]?.trim();
  if (!rawRef) return text;
  const payload = JSON.parse(await readFile(join(workspacePath, rawRef), 'utf8'));
  const rawPayload = isRecord(payload.payload) ? payload.payload : payload;
  const input = isRecord(rawPayload.input) ? rawPayload.input : {};
  return typeof input.text === 'string' ? input.text : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function runTabulaSapiensThreeRoundContinuationSmoke() {
  const threeRoundWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-tabula-three-round-'));
  const prompts: string[] = [];
  const originalRepairFlag = process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR;
  process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR = '0';

  const round1Task = String.raw`
import json
import sys
output_path = sys.argv[2]
payload = {
  "message": "Tabula Sapiens atlas plan and executable task scaffold generated.",
  "confidence": 0.82,
  "claimType": "evidence-summary",
  "evidenceLevel": "workspace-task",
  "reasoningTrace": "Round 1 created a continuation-ready plan and task refs.",
  "claims": [{"text": "Generated QC/integration/clustering/marker/cell-type/composition plan.", "confidence": 0.82, "evidenceLevel": "workspace-task"}],
  "uiManifest": [
    {"componentId": "record-table", "artifactRef": "tabula-plan", "priority": 1},
    {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 2},
    {"componentId": "execution-unit-table", "artifactRef": "tabula-plan", "priority": 3}
  ],
  "executionUnits": [{
    "id": "tabula-round-1",
    "status": "done",
    "tool": "agentserver.generated.python",
    "codeRef": ".sciforge/tasks/tabula-round-1.py",
    "stdoutRef": ".sciforge/logs/tabula-round-1.stdout.log",
    "stderrRef": ".sciforge/logs/tabula-round-1.stderr.log",
    "outputRef": ".sciforge/task-results/tabula-round-1.json",
    "params": "{}"
  }],
  "artifacts": [{
    "id": "tabula-plan",
    "type": "runtime-artifact",
    "producerScenario": "omics",
    "schemaVersion": "1",
    "dataRef": ".sciforge/task-results/tabula-round-1.json",
    "metadata": {
      "runId": "tabula-round-1",
      "producer": "agentserver.generated.python",
      "codeRef": ".sciforge/tasks/tabula-round-1.py",
      "stdoutRef": ".sciforge/logs/tabula-round-1.stdout.log",
      "stderrRef": ".sciforge/logs/tabula-round-1.stderr.log"
    },
    "data": {"rows": [{"step": "QC", "status": "planned"}, {"step": "marker genes", "status": "pending"}, {"step": "cross-organ composition", "status": "pending"}]}
  }, {
    "id": "omics-differential-expression",
    "type": "omics-differential-expression",
    "producerScenario": "omics",
    "schemaVersion": "1",
    "metadata": {"runId": "tabula-round-1", "producer": "agentserver.generated.python"},
    "data": {"rows": [{"feature": "marker genes", "status": "planned"}]}
  }, {
    "id": "research-report",
    "type": "research-report",
    "producerScenario": "omics",
    "schemaVersion": "1",
    "metadata": {"runId": "tabula-round-1", "producer": "agentserver.generated.python"},
    "data": {"markdown": "Round 1 plan: QC, integration, clustering, marker genes, annotation, composition comparison."}
  }]
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

  const round2FailTask = String.raw`
import sys
sys.stderr.write("first pass marker table crashed: missing organ_celltype_matrix.tsv\n")
raise SystemExit(2)
`;

  const threeRoundServer = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      sendContextSnapshot(res, 'mock-tabula-three-round-context');
      return;
    }
    if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    const body = await readJson(req);
    const input = isRecord(body.input) ? body.input : {};
    const text = await expandCompactedInputText(typeof input.text === 'string' ? input.text : '', threeRoundWorkspace);
    prompts.push(text);

    if (prompts.length === 1) {
      assert.match(text, /Scenario goal|Tabula Sapiens|recentConversation|expectedArtifactTypes/i);
      sendGeneration(res, req.url, 'tabula-round-1', round1Task);
      return;
    }
    if (prompts.length === 2) {
      assert.match(text, /继续|marker gene|跨器官|系统性报告/i);
      assert.match(text, /tabula-plan|dataRef|producer|runId/i);
      assert.match(text, /recentExecutionRefs|stdoutRef|stderrRef|outputRef|codeRef/i);
      sendGeneration(res, req.url, 'tabula-round-2', round2FailTask);
      return;
    }

    assert.match(text, /继续|marker gene|跨器官|系统性报告|repair-or-continue-project/i);
    sendAgentServerRun(res, req.url, {
      ok: true,
      data: {
        run: {
          id: 'mock-tabula-round-3',
          status: 'completed',
          output: {
            result: {
              message: 'Preserved the previous failure and returned repair-needed instead of demo success.',
              confidence: 0.41,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              reasoningTrace: 'Round 3 read priorAttempts and stderrRef before deciding the blocker remains.',
              claims: [{ text: 'The marker/composition continuation is blocked on missing organ_celltype_matrix.tsv.', confidence: 0.41, evidenceLevel: 'runtime' }],
              uiManifest: [
                { componentId: 'report-viewer', artifactRef: 'tabula-repair-report', priority: 1 },
                { componentId: 'execution-unit-table', artifactRef: 'tabula-repair-report', priority: 2 }
              ],
              executionUnits: [{
                id: 'tabula-round-3-repair-diagnosis',
                status: 'repair-needed',
                tool: 'agentserver.repair-diagnosis',
                params: JSON.stringify({ readRefs: ['.sciforge/logs/tabula-round-2.stderr.log'] }),
                failureReason: 'first pass marker table crashed: missing organ_celltype_matrix.tsv',
                codeRef: '.sciforge/tasks/tabula-round-2.py',
                stderrRef: '.sciforge/logs/tabula-round-2.stderr.log',
                outputRef: '.sciforge/task-results/tabula-round-2.json',
                recoverActions: ['provide-organ-celltype-matrix', 'rerun-marker-composition-task'],
                nextStep: 'Read the referenced stderr log, then regenerate the marker/composition task once input data exists.'
              }],
              artifacts: [{
                id: 'tabula-repair-report',
                type: 'research-report',
                producerScenario: 'omics',
                schemaVersion: '1',
                metadata: {
                  status: 'repair-needed',
                  failureReason: 'first pass marker table crashed: missing organ_celltype_matrix.tsv',
                  stderrRef: '.sciforge/logs/tabula-round-2.stderr.log'
                },
                data: { markdown: 'Repair needed: previous marker/composition task failed because organ_celltype_matrix.tsv is missing.' }
              }]
            }
          }
        }
      }
    });
  });

  await new Promise<void>((resolve) => threeRoundServer.listen(0, '127.0.0.1', resolve));
  const address = threeRoundServer.address();
  assert.ok(address && typeof address === 'object');
  const threeRoundBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const round1 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      prompt: 'Scenario goal: 创建 Tabula Sapiens 多器官 scRNA 复现场景并运行，先生成分析计划和可执行 task',
      workspacePath: threeRoundWorkspace,
      agentServerBaseUrl: threeRoundBaseUrl,
      expectedArtifactTypes: ['runtime-artifact', 'omics-differential-expression', 'research-report'],
      selectedComponentIds: selectedComponents,
      uiState: {
        recentConversation: ['user: 创建 Tabula Sapiens 多器官 scRNA 复现场景并运行，先生成分析计划和可执行 task'],
        expectedArtifactTypes: ['runtime-artifact', 'omics-differential-expression', 'research-report'],
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true
      },
      artifacts: []
    });
    assert.ok(round1.artifacts.some((artifact) => artifact.id === 'tabula-plan'));

    const round2 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      prompt: 'Scenario goal: Tabula Sapiens 多器官 scRNA atlas。继续，补齐 marker gene 表、跨器官细胞组成比较和系统性报告',
      workspacePath: threeRoundWorkspace,
      agentServerBaseUrl: threeRoundBaseUrl,
      expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
      selectedComponentIds: selectedComponents,
      uiState: {
        recentConversation: [
          'user: 创建 Tabula Sapiens 多器官 scRNA 复现场景并运行，先生成分析计划和可执行 task',
          'assistant: 已生成 tabula-plan artifact 和可执行 task refs。',
          'user: 继续，补齐 marker gene 表、跨器官细胞组成比较和系统性报告'
        ],
        recentExecutionRefs: round1.executionUnits,
        expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true
      },
      artifacts: round1.artifacts
    });
    const round2Unit = round2.executionUnits.find((unit) => isRecord(unit) && unit.status === 'repair-needed');
    assert.ok(isRecord(round2Unit));
    assert.match(String(round2Unit.failureReason || ''), /first pass marker table crashed|missing organ_celltype_matrix/i);
    assert.ok(round2.uiManifest.some((slot) => slot.componentId === 'execution-unit-table'));

    const round3 = await runWorkspaceRuntimeGateway({
      skillDomain: 'omics',
      prompt: 'Scenario goal: Tabula Sapiens 多器官 scRNA atlas。如果有失败，读取上一轮日志并修复；不要伪造成功',
      workspacePath: threeRoundWorkspace,
      agentServerBaseUrl: threeRoundBaseUrl,
      expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
      selectedComponentIds: selectedComponents,
      uiState: {
        recentConversation: [
          'user: 创建 Tabula Sapiens 多器官 scRNA 复现场景并运行，先生成分析计划和可执行 task',
          'assistant: 已生成 tabula-plan artifact 和可执行 task refs。',
          'user: 继续，补齐 marker gene 表、跨器官细胞组成比较和系统性报告',
          `assistant: 上一轮失败：${String(round2Unit.failureReason)}`,
          'user: 如果有失败，读取上一轮日志并修复；不要伪造成功'
        ],
        recentExecutionRefs: round2.executionUnits,
        expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
        selectedComponentIds: selectedComponents,
        forceAgentServerGeneration: true
      },
      artifacts: [...round2.artifacts, ...round1.artifacts]
    });
    assert.ok(round3.executionUnits.some((unit) => isRecord(unit) && unit.status === 'repair-needed' && /first pass marker table crashed/.test(String(unit.failureReason || ''))));
    assert.ok(prompts.length >= 3 && prompts.length <= 4);
    console.log('[ok] Tabula Sapiens three-round continuation preserves artifacts, failureReason, and code/log refs');
  } finally {
    if (originalRepairFlag === undefined) delete process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR;
    else process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR = originalRepairFlag;
    await new Promise<void>((resolve) => threeRoundServer.close(() => resolve()));
  }
}

function sendGeneration(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  requestUrl: string | undefined,
  id: string,
  content: string,
) {
  sendAgentServerRun(res, requestUrl, {
    ok: true,
    data: {
      run: {
        id: `mock-${id}`,
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: `.sciforge/tasks/${id}.py`, language: 'python', content }],
            entrypoint: { language: 'python', path: `.sciforge/tasks/${id}.py` },
            environmentRequirements: { language: 'python' },
            validationCommand: `python .sciforge/tasks/${id}.py <input> <output>`,
            expectedArtifacts,
            patchSummary: `Generated ${id}.`
          }
        }
      }
    }
  });
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

function sendContextSnapshot(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  id: string,
) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      session: { id, status: 'active' },
      operationalGuidance: { summary: ['context healthy'], items: [] },
      workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
      workBudget: { status: 'healthy', approxCurrentWorkTokens: 160 },
      recentTurns: [],
      currentWorkEntries: [],
    },
  }));
}
