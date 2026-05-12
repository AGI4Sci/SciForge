import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { readTaskAttempts } from '../../src/runtime/task-attempt-history.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-failed-payload-repair-'));
let generationRequests = 0;
let repairRequests = 0;

const badTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

payload = {
  "message": "Task failed before real artifacts were created.",
  "confidence": 0.0,
  "claimType": "error",
  "evidenceLevel": "none",
  "reasoningTrace": "intentional failing payload",
  "claims": [],
  "uiManifest": [],
  "executionUnits": [{
    "id": "generic-task",
    "status": "failed-with-reason",
    "failureReason": "Intentional transient bug in generated task"
  }],
  "artifacts": []
}
with open(output_path, "w", encoding="utf-8") as handle:
  json.dump(payload, handle, indent=2)
sys.exit(1)
`;

const fixedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
with open(input_path, "r", encoding="utf-8") as handle:
  request = json.load(handle)

payload = {
  "message": "Repair produced the requested generic artifact.",
  "confidence": 0.82,
  "claimType": "fact",
  "evidenceLevel": "runtime",
  "reasoningTrace": "repaired after failed-with-reason payload",
  "claims": [{
    "id": "claim.repaired",
    "text": "A failed generated task can be repaired and rerun even when it wrote valid failure JSON.",
    "supportingRefs": ["artifact.repaired"]
  }],
  "uiManifest": [{
    "componentId": "report-viewer",
    "artifactRef": "artifact.repaired"
  }],
  "executionUnits": [{
    "id": "generic-task",
    "status": "done",
    "tool": "generic.generated.task",
    "params": request.get("prompt", "")[:80]
  }],
  "artifacts": [{
    "id": "artifact.repaired",
    "type": "research-report",
    "data": { "markdown": "Repaired generic task completed." }
  }]
}
with open(output_path, "w", encoding="utf-8") as handle:
  json.dump(payload, handle, indent=2)
`;

const stillBrokenRepairTask = String.raw`
raise RuntimeError("repair attempt still needs another AgentServer pass")
`;

const server = createServer(async (req, res) => {
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const metadata = isRecord(body.input) && isRecord(body.input.metadata) ? body.input.metadata : {};
  if (metadata.purpose === 'workspace-task-repair') {
    repairRequests += 1;
    const codeRef = String(metadata.codeRef || '');
    assert.match(codeRef, /^\.sciforge\/sessions\/.+\/tasks\/generated-literature-/);
    await writeFile(join(workspace, codeRef), repairRequests === 1 ? stillBrokenRepairTask : fixedTask);
    const result = {
      ok: true,
      data: {
        run: {
          id: `mock-repair-run-${repairRequests}`,
          status: 'completed',
          output: { result: repairRequests === 1
            ? 'First repair pass changed the task, but another rerun will expose the remaining execution error.'
            : 'Replaced failing task code with a repaired generic implementation.' },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  generationRequests += 1;
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-generation-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{
              path: '.sciforge/tasks/generic-failing-task.py',
              language: 'python',
              content: badTask,
            }],
            entrypoint: {
              language: 'python',
              path: '.sciforge/tasks/generic-failing-task.py',
            },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/generic-failing-task.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated a task that intentionally fails once.',
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
    prompt: 'Generic complex task that must be generated, repaired if it writes a failed payload, and rerun.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['research-report'],
    uiState: {
      sessionId: 'session-failed-payload-repair',
      forceAgentServerGeneration: true,
    },
  });

  assert.equal(generationRequests, 1);
  assert.ok(repairRequests >= 2 && repairRequests <= 3, 'failed payload repair should retry boundedly after the intentionally broken first repair');
  assert.match(result.message, /Repair produced/);
  assert.ok(['self-healed', 'needs-human'].includes(String(result.executionUnits[0]?.status)));
  if (result.executionUnits[0]?.status === 'self-healed') {
    assert.equal(result.executionUnits[0]?.attempt, 3);
  }
  assert.ok(result.artifacts.some((artifact) => artifact.id === 'artifact.repaired'));

  const taskId = String(result.executionUnits[0]?.diffRef || '').match(/task-diffs\/(.+)-attempt-\d+\.diff\.txt/)?.[1];
  assert.ok(taskId);
  const attemptHistory = await readTaskAttempts(workspace, taskId);
  assert.equal(attemptHistory.length, 3);
  assert.equal(attemptHistory[0].status, 'repair-needed');
  assert.match(String(attemptHistory[0].failureReason || ''), /failed payload|Intentional transient bug/);
  assert.equal(attemptHistory[1].status, 'failed-with-reason');
  assert.match(String(attemptHistory[1].failureReason || ''), /still needs another AgentServer pass/);
  assert.equal(attemptHistory[2].status, 'done');

  console.log('[ok] generated task failed payload triggers generic AgentServer repair loop until rerun succeeds');
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
