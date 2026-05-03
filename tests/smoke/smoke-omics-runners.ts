import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-omics-runner-smoke-'));
await mkdir(join(workspace, 'data'), { recursive: true });
await writeFile(join(workspace, 'data', 'matrix.csv'), [
  'gene,c1,c2,t1,t2',
  'TP53,10,11,40,42',
  'MYC,80,82,20,18',
  'ACTB,50,51,50,49',
  '',
].join('\n'));
await writeFile(join(workspace, 'data', 'metadata.csv'), [
  'sample,condition',
  'c1,control',
  'c2,control',
  't1,treated',
  't2,treated',
  '',
].join('\n'));

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)
payload = {
    "message": "Generated omics runner completed",
    "confidence": 0.82,
    "claimType": "evidence-summary",
    "evidenceLevel": "workspace-task",
    "reasoningTrace": "AgentServer generated a task that honored the requested omics runner parameters.",
    "claims": [],
    "uiManifest": [{"componentId": "point-set-viewer", "artifactRef": "omics-differential-expression", "priority": 1}],
    "executionUnits": [{"id": "omics-runner-generated", "skillId": "agentserver.generate.omics", "tool": "agentserver.generated.python", "status": "done"}],
    "artifacts": [{
        "id": "omics-differential-expression",
        "type": "omics-differential-expression",
        "producerScenario": "omics",
        "schemaVersion": "1",
        "metadata": {
            "requestedRunner": "scanpy.rank_genes_groups",
            "effectiveRunner": "omics.python-csv-differential",
            "runtimeAvailability": {"scanpy": False, "csvFallback": True}
        },
        "data": {"rows": [{"gene": "TP53", "log2FoldChange": 2.0, "pValue": 0.01}]}
    }]
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
        session: { id: 'mock-omics-runner-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 80 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }
  if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.end(JSON.stringify({
    result: {
      ok: true,
      data: {
        run: {
          id: 'mock-omics-runner-generation',
          status: 'completed',
          output: {
            result: {
              taskFiles: [{ path: '.sciforge/tasks/omics-runner.py', language: 'python', content: generatedTask }],
              entrypoint: { language: 'python', path: '.sciforge/tasks/omics-runner.py' },
              environmentRequirements: { language: 'python' },
              validationCommand: 'python .sciforge/tasks/omics-runner.py <input> <output>',
              expectedArtifacts: ['omics-differential-expression'],
              patchSummary: 'Generated omics runner task.',
            },
          },
        },
      },
    },
  }) + '\n');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

const result = await runWorkspaceRuntimeGateway({
  skillDomain: 'omics',
  workspacePath: workspace,
  agentServerBaseUrl: baseUrl,
  prompt: [
    'matrixRef=data/matrix.csv',
    'metadataRef=data/metadata.csv',
    'groupColumn=condition',
    'caseGroup=treated',
    'controlGroup=control',
    'runner=scanpy',
  ].join(' '),
  uiState: { forceAgentServerGeneration: true },
});

assert.equal(result.artifacts[0]?.type, 'omics-differential-expression');
const metadata = (result.artifacts[0].metadata ?? {}) as Record<string, unknown>;
assert.equal(metadata.requestedRunner, 'scanpy.rank_genes_groups');
assert.ok(metadata.effectiveRunner === 'scanpy.rank_genes_groups' || metadata.effectiveRunner === 'omics.python-csv-differential');
assert.ok(metadata.runtimeAvailability);
assert.equal(result.executionUnits[0]?.skillId, 'agentserver.generate.omics');
console.log(`[ok] omics runner smoke requested=${metadata.requestedRunner} effective=${metadata.effectiveRunner}`);

await new Promise<void>((resolve) => server.close(() => resolve()));
