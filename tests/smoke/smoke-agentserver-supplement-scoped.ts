import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-supplement-scoped-'));
let generationCalls = 0;
let sawPaperListSupplement = false;

const reportOnlyTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

payload = {
    "message": "Follow-up report patch completed.",
    "confidence": 0.88,
    "claimType": "artifact-display",
    "evidenceLevel": "agentserver-supplement-scoped-smoke",
    "reasoningTrace": "Generated task only promised research-report for this follow-up.",
    "claims": [],
    "uiManifest": [
        {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 1}
    ],
    "executionUnits": [
        {"id": "followup-report-task", "status": "done", "tool": "agentserver.generated.python"}
    ],
    "artifacts": [
        {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "data": {"markdown": "# Follow-up\n\nOnly the current turn report patch was requested."}
        }
    ]
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { session: { id: 'scoped-session', status: 'active' } } }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  generationCalls += 1;
  const body = await readJson(req);
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  if (promptText.includes('Missing expected artifact types: paper-list')) sawPaperListSupplement = true;
  const result = {
    ok: true,
    data: {
      run: {
        id: `mock-agentserver-scoped-${generationCalls}`,
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: '.bioagent/tasks/followup-report.py', language: 'python', content: reportOnlyTask }],
            entrypoint: { language: 'python', path: '.bioagent/tasks/followup-report.py' },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .bioagent/tasks/followup-report.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated only the follow-up research-report artifact.',
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
    skillDomain: 'literature',
    prompt: 'Follow up: only patch the report, do not regenerate the full scenario outputs.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report', 'paper-list'],
    selectedComponentIds: ['report-viewer', 'paper-card-list'],
    artifacts: [],
  });

  assert.equal(generationCalls, 1);
  assert.equal(sawPaperListSupplement, false);
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'research-report'));
  assert.equal(result.artifacts.some((artifact) => artifact.type === 'paper-list'), false);
  assert.doesNotMatch(String(result.reasoningTrace), /Supplemental AgentServer\/backend generation/);
  console.log('[ok] agentserver supplement is scoped to generated task expected artifacts');
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
