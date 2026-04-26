import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-generation-'));
let sawGenerationRequest = false;
let sawPriorAttempt = false;
let sawScopeSummary = false;

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

payload = {
    "message": "Generated literature task completed.",
    "confidence": 0.73,
    "claimType": "evidence-summary",
    "evidenceLevel": "generated-task-smoke",
    "reasoningTrace": "Generated workspace task handled prompt: " + request.get("prompt", ""),
    "claims": [
        {
            "id": "claim.generated.literature",
            "text": "AgentServer generation can create and run workspace-local task code when no local skill matches.",
            "supportingRefs": ["artifact.generated.paper-list"]
        }
    ],
    "uiManifest": [
        {
            "componentId": "paper-list",
            "artifactRef": "artifact.generated.paper-list",
            "layout": "list"
        }
    ],
    "executionUnits": [
        {
            "id": "generated-literature-task",
            "status": "done",
            "tool": "agentserver.generated.python",
            "attempt": 1
        }
    ],
    "artifacts": [
        {
            "id": "artifact.generated.paper-list",
            "type": "paper-list",
            "items": [
                {
                    "title": "Generated BioAgent task smoke",
                    "year": 2026,
                    "source": "mock-agentserver"
                }
            ]
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
  const metadata = isRecord(body.input) && isRecord(body.input.metadata) ? body.input.metadata : {};
  assert.equal(metadata.purpose, 'workspace-task-generation');
  assert.equal(metadata.skillDomain, 'literature');
  assert.equal(metadata.skillId, 'agentserver.generate.literature');
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  sawPriorAttempt = promptText.includes('prior-generation-failure');
  sawScopeSummary = promptText.includes('scopeCheck') && promptText.includes('handoffTargets');
  sawGenerationRequest = true;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-generation-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [
              {
                path: '.bioagent/tasks/generated-literature.py',
                language: 'python',
                content: generatedTask,
              },
            ],
            entrypoint: {
              language: 'python',
              path: '.bioagent/tasks/generated-literature.py',
            },
            environmentRequirements: {
              language: 'python',
            },
            validationCommand: 'python .bioagent/tasks/generated-literature.py <input> <output>',
            expectedArtifacts: ['paper-list'],
            patchSummary: 'Generated a literature fallback task for smoke validation.',
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
  await appendTaskAttempt(workspace, {
    id: 'prior-generation-failure',
    prompt: 'older custom literature request',
    skillDomain: 'literature',
    skillId: 'agentserver.generate.literature',
    attempt: 1,
    status: 'failed-with-reason',
    failureReason: 'No validated task existed before generation.',
    createdAt: '2026-04-20T00:00:00.000Z',
  });
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'custom literature request that intentionally bypasses local skills',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    uiState: {
      scopeCheck: {
        inScope: false,
        handoffTargets: ['knowledge'],
      },
    },
  });

  assert.equal(sawGenerationRequest, true);
  assert.equal(sawPriorAttempt, true);
  assert.equal(sawScopeSummary, true);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].type, 'paper-list');
  assert.equal(result.executionUnits.length, 1);
  assert.equal(result.executionUnits[0].status, 'done');
  assert.equal(result.executionUnits[0].agentServerGenerated, true);
  assert.equal(result.executionUnits[0].agentServerRunId, 'mock-agentserver-generation-run');
  assert.match(String(result.reasoningTrace), /AgentServer generation run/);
  assert.match(String(result.reasoningTrace), /Generated a literature fallback task/);

  const attemptFiles = await readdir(join(workspace, '.bioagent', 'task-attempts'));
  assert.equal(attemptFiles.length, 2);
  const generatedAttemptFile = attemptFiles.find((file) => file.startsWith('generated-literature-'));
  assert.ok(generatedAttemptFile);
  const attemptHistory = JSON.parse(await readFile(join(workspace, '.bioagent', 'task-attempts', generatedAttemptFile), 'utf8'));
  assert.equal(attemptHistory.attempts.length, 1);
  assert.equal(attemptHistory.attempts[0].status, 'done');
  assert.match(attemptHistory.attempts[0].codeRef, /^\.bioagent\/tasks\/generated-literature-[a-f0-9]+\/generated-literature\.py$/);

  console.log('[ok] agentserver generation smoke writes generated task code and runs it through gateway');
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
