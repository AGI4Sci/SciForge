import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../../src/runtime/runtime-types.js';
import { tryAgentServerSupplementMissingArtifacts } from '../../src/runtime/gateway/generated-task-runner-supplement-lifecycle.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-supplement-'));
await writeFile(join(workspace, 'matrix.csv'), [
  'gene,c1,c2,t1,t2',
  'EGFR,10,11,40,42',
  'KRAS,30,31,12,13',
  'ACTB,20,21,20,19',
  '',
].join('\n'));
await writeFile(join(workspace, 'metadata.csv'), [
  'sample,condition',
  'c1,control',
  'c2,control',
  't1,treated',
  't2,treated',
  '',
].join('\n'));
const smokeSkill = {
  id: 'mock.agentserver.supplement',
  kind: 'package',
  available: true,
  reason: 'smoke',
  checkedAt: '2026-01-01T00:00:00.000Z',
  manifestPath: 'capability:mock.agentserver.supplement',
  manifest: {
    id: 'mock.agentserver.supplement',
    kind: 'package',
    description: 'Smoke supplement skill',
    skillDomains: ['omics'],
    inputContract: {},
    outputArtifactSchema: {},
    entrypoint: { type: 'workspace-task' },
    environment: {},
    validationSmoke: {},
    examplePrompts: [],
    promotionHistory: [],
  },
} as SkillAvailability;

const lifecyclePrimaryPayload: ToolPayload = {
  message: 'Primary generated omics artifact without report.',
  confidence: 0.8,
  claimType: 'evidence-summary',
  evidenceLevel: 'agentserver-supplement-smoke',
  reasoningTrace: 'Primary lifecycle payload intentionally misses research-report.',
  claims: [],
  uiManifest: [{ componentId: 'point-set-viewer', artifactRef: 'omics-differential-expression' }],
  executionUnits: [{ id: 'primary-omics-task', status: 'done', tool: 'agentserver.generated.python' }],
  artifacts: [{
    id: 'omics-differential-expression',
    type: 'omics-differential-expression',
    data: { rows: [{ gene: 'EGFR', log2FoldChange: 2.1, padj: 0.01 }] },
  }],
  budgetDebits: [budgetDebit('budgetDebit:primary-supplement-smoke', 'sciforge.generated-task-runner.primary', ['audit:primary-budget'])],
  workEvidence: [workEvidence('primary-omics-evidence', ['budgetDebit:primary-supplement-smoke'])],
};
const lifecycleSupplementPayload: ToolPayload = {
  message: 'Supplement generated research report.',
  confidence: 0.86,
  claimType: 'evidence-summary',
  evidenceLevel: 'agentserver-supplement-smoke',
  reasoningTrace: 'Supplement lifecycle payload fills research-report.',
  claims: [],
  uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
  executionUnits: [{ id: 'supplement-report-task', status: 'done', tool: 'agentserver.generated.python' }],
  artifacts: [{
    id: 'research-report',
    type: 'research-report',
    data: { markdown: '# Supplemental report' },
  }],
  budgetDebits: [budgetDebit('budgetDebit:supplement-supplement-smoke', 'sciforge.generated-task-runner', [
    'audit:supplement-budget',
    '.sciforge/capability-evolution-ledger/records.jsonl#L999',
  ])],
  workEvidence: [workEvidence('supplement-report-evidence', ['budgetDebit:supplement-supplement-smoke'])],
};
const lifecycleMerged = await tryAgentServerSupplementMissingArtifacts({
  request: {
    skillDomain: 'omics',
    prompt: 'lifecycle supplement merge smoke',
    workspacePath: workspace,
    expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
    artifacts: [],
  },
  skill: smokeSkill,
  skills: [smokeSkill],
  workspace,
  payload: lifecyclePrimaryPayload,
  primaryTaskId: 'primary-omics-task',
  primaryRunId: 'primary-run',
  primaryRun: smokeRun(workspace),
  primaryRefs: {
    taskRel: '.sciforge/tasks/primary-omics.py',
    outputRel: '.sciforge/task-results/primary-omics.json',
    stdoutRel: '.sciforge/task-results/primary-omics.stdout.txt',
    stderrRel: '.sciforge/task-results/primary-omics.stderr.txt',
  },
  expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
  deps: {} as never,
  runGeneratedTask: async () => lifecycleSupplementPayload,
});
assert.ok(lifecycleMerged, 'supplement lifecycle should merge successful supplement payload');
assert.ok(lifecycleMerged.budgetDebits?.some((debit) => debit.debitId === 'budgetDebit:primary-supplement-smoke'));
const lifecycleSupplementDebit = lifecycleMerged.budgetDebits?.find((debit) => debit.debitId === 'budgetDebit:supplement-supplement-smoke');
assert.ok(lifecycleSupplementDebit, 'merged lifecycle payload should retain supplement budget debit');
assert.ok(lifecycleSupplementDebit.sinkRefs.auditRefs.includes('audit:supplement-budget'));
assert.ok(lifecycleSupplementDebit.sinkRefs.auditRefs.includes('.sciforge/capability-evolution-ledger/records.jsonl#L999'));
assert.ok(lifecycleMerged.workEvidence?.some((entry) => entry.id === 'primary-omics-evidence'));
assert.ok(lifecycleMerged.workEvidence?.some((entry) => entry.budgetDebitRefs?.includes('budgetDebit:supplement-supplement-smoke')));

let sawSupplementPrompt = false;

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

payload = {
    "message": "Supplemented research report.",
    "confidence": 0.81,
    "claimType": "evidence-summary",
    "evidenceLevel": "agentserver-supplement-smoke",
    "reasoningTrace": "Supplement generated from expected artifact contract.",
    "claims": [],
    "uiManifest": [
        {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 1}
    ],
    "executionUnits": [
        {"id": "supplement-report-task", "status": "done", "tool": "agentserver.generated.python", "attempt": request.get("attempt", 1)}
    ],
    "artifacts": [
        {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-supplement"},
            "data": {
                "markdown": "# Supplemental report\n\nThe missing research-report artifact was generated after local skill execution.",
                "sections": [{"title": "Supplement", "content": "Generated from missing expected artifact types."}]
            }
        }
    ]
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

const omicsOnlyTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

payload = {
    "message": "Generated omics artifact without report.",
    "confidence": 0.77,
    "claimType": "evidence-summary",
    "evidenceLevel": "agentserver-supplement-smoke",
    "reasoningTrace": "Initial generated task intentionally emitted only omics so supplement can fill report.",
    "claims": [],
    "workEvidence": [
        {
            "kind": "command",
            "id": "primary-omics-evidence",
            "status": "success",
            "provider": "mock-agentserver-primary",
            "resultCount": 1,
            "evidenceRefs": ["artifact:omics-differential-expression"],
            "recoverActions": []
        }
    ],
    "uiManifest": [
        {"componentId": "point-set-viewer", "artifactRef": "omics-differential-expression", "priority": 1}
    ],
    "executionUnits": [
        {"id": "initial-omics-task", "status": "done", "tool": "agentserver.generated.python", "attempt": request.get("attempt", 1)}
    ],
    "artifacts": [
        {
            "id": "omics-differential-expression",
            "type": "omics-differential-expression",
            "producerScenario": "omics-differential-exploration",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-supplement"},
            "data": {"rows": [{"gene": "EGFR", "log2FoldChange": 2.1, "padj": 0.01}]}
        }
    ]
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
        session: { id: 'supplement-session', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
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
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  sawSupplementPrompt = promptText.includes('Missing expected artifact types: research-report');
  const taskContent = sawSupplementPrompt ? generatedTask : omicsOnlyTask;
  const taskName = sawSupplementPrompt ? 'supplement-report.py' : 'initial-omics.py';
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-supplement-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: `.sciforge/tasks/${taskName}`, language: 'python', content: taskContent }],
            entrypoint: { language: 'python', path: `.sciforge/tasks/${taskName}` },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/supplement-report.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated missing research-report artifact.',
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

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'omics',
    prompt: 'Generate and execute an omics differential expression workspace task using matrixRef=matrix.csv metadataRef=metadata.csv groupColumn=condition caseGroup=treated controlGroup=control runner=csv show volcano heatmap, then return omics-differential-expression and research-report artifacts.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
    selectedComponentIds: ['report-viewer', 'point-set-viewer', 'matrix-viewer', 'execution-unit-table'],
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.equal(typeof sawSupplementPrompt, 'boolean');
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'omics-differential-expression'));
  const report = result.artifacts.find((artifact) => artifact.type === 'research-report');
  assert.ok(report);
  assert.notEqual(isRecord(report.metadata) ? report.metadata.status : undefined, 'repair-needed');
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'report-viewer' && slot.artifactRef === 'research-report'));
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'point-set-viewer'));
  assert.ok(result.workEvidence?.some((entry) => entry.id === 'primary-omics-evidence'));
  assert.match(String(result.reasoningTrace), /Supplemental AgentServer\/backend generation/);
  console.log('[ok] agentserver supplement fills missing expected artifacts after local skill output');
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

function budgetDebit(
  debitId: string,
  capabilityId: string,
  auditRefs: string[],
): NonNullable<ToolPayload['budgetDebits']>[number] {
  return {
    contract: 'sciforge.capability-budget-debit.v1',
    schemaVersion: 1,
    debitId,
    invocationId: `${debitId}:invocation`,
    capabilityId,
    candidateId: 'mock.agentserver.supplement',
    manifestRef: 'capability:mock.agentserver.supplement',
    subjectRefs: ['primary-omics-task'],
    debitLines: [{ dimension: 'toolCalls', amount: 1, reason: 'supplement smoke' }],
    exceeded: false,
    exhaustedDimensions: [],
    sinkRefs: {
      executionUnitRef: 'supplement-report-task',
      workEvidenceRefs: ['supplement-report-evidence'],
      auditRefs,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function workEvidence(id: string, budgetDebitRefs: string[]): NonNullable<ToolPayload['workEvidence']>[number] {
  return {
    kind: 'command',
    id,
    status: 'success',
    provider: 'mock-agentserver-supplement',
    resultCount: 1,
    evidenceRefs: [`workEvidence:${id}`],
    recoverActions: [],
    budgetDebitRefs,
  };
}

function smokeRun(workspacePath: string): WorkspaceTaskRunResult {
  return {
    spec: {
      id: 'primary-omics-task',
      language: 'python',
      entrypoint: '.sciforge/tasks/primary-omics.py',
      input: {},
      outputRel: '.sciforge/task-results/primary-omics.json',
      stdoutRel: '.sciforge/task-results/primary-omics.stdout.txt',
      stderrRel: '.sciforge/task-results/primary-omics.stderr.txt',
      taskRel: '.sciforge/tasks/primary-omics.py',
    },
    workspace: workspacePath,
    command: 'python',
    args: [],
    exitCode: 0,
    stdoutRef: '.sciforge/task-results/primary-omics.stdout.txt',
    stderrRef: '.sciforge/task-results/primary-omics.stderr.txt',
    outputRef: '.sciforge/task-results/primary-omics.json',
    stdout: '',
    stderr: '',
    runtimeFingerprint: {},
  };
}
