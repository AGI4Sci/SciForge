import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-supplement-'));
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

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  sawSupplementPrompt = promptText.includes('Missing expected artifact types: research-report');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-supplement-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: '.bioagent/tasks/supplement-report.py', language: 'python', content: generatedTask }],
            entrypoint: { language: 'python', path: '.bioagent/tasks/supplement-report.py' },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .bioagent/tasks/supplement-report.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated missing research-report artifact.',
          },
        },
      },
    },
  }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'omics',
    prompt: 'matrixRef=matrix.csv metadataRef=metadata.csv groupColumn=condition caseGroup=treated controlGroup=control runner=csv show volcano heatmap',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['omics-differential-expression', 'research-report'],
    selectedComponentIds: ['report-viewer', 'volcano-plot', 'heatmap-viewer', 'execution-unit-table'],
    artifacts: [],
  });

  assert.equal(sawSupplementPrompt, true);
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'omics-differential-expression'));
  const report = result.artifacts.find((artifact) => artifact.type === 'research-report');
  assert.ok(report);
  assert.notEqual(isRecord(report.metadata) ? report.metadata.status : undefined, 'repair-needed');
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'report-viewer' && slot.artifactRef === 'research-report'));
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'volcano-plot'));
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
