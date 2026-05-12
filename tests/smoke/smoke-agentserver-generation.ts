import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-generation-'));
let sawGenerationRequest = false;
let sawLeakedOlderAttempt = false;
let sawScopeSummary = false;
let sawContextEnvelope = false;
let sawContinuationRefs = false;
let sawFullContextFallback = false;
let contextEndpointUnavailable = false;
let requestCount = 0;
const agentIds: string[] = [];
const promptLengths: number[] = [];
const contextBytes: number[] = [];

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
                    "title": "Generated SciForge task smoke",
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
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    if (contextEndpointUnavailable) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'context unavailable' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'session-smoke-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 120 },
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
  const metadata = isRecord(body.input) && isRecord(body.input.metadata) ? body.input.metadata : {};
  assert.ok(['workspace-task-generation', 'workspace-task-generation-inline'].includes(String(metadata.purpose)));
  assert.equal(metadata.skillDomain, 'literature');
  assert.equal(metadata.skillId, 'agentserver.generate.literature');
  assert.equal(metadata.contextEnvelopeVersion, 'sciforge.context-envelope.v1');
  const agentId = String(isRecord(body.agent) ? body.agent.id : '');
  assert.match(agentId, /^sciforge-literature-[a-f0-9]{12}$/);
  agentIds.push(agentId);
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  promptLengths.push(promptText.length);
  if (typeof metadata.contextEnvelopeBytes === 'number') contextBytes.push(metadata.contextEnvelopeBytes);
  requestCount += 1;
  sawLeakedOlderAttempt ||= promptText.includes('prior-generation-failure');
  sawScopeSummary ||= promptText.includes('scopeCheck') && promptText.includes('handoffTargets');
  sawContextEnvelope ||= promptText.includes('"version": "sciforge.context-envelope.v1"')
    && promptText.includes('"workspaceFacts"')
    && promptText.includes('"longTermRefs"');
  if (promptText.includes('Where did the generated files go?')) {
    assert.ok(['delta', 'full'].includes(String(metadata.contextMode)));
    sawContinuationRefs = promptText.includes('Where did the generated files go?')
      && /"mode": "(delta|full)"/.test(promptText)
      && promptText.includes('"workspaceTreeHash"')
      && promptText.includes('"sessionId": "session-smoke-context"')
      && promptText.includes('"recentExecutionRefs"')
      && promptText.includes('"codeRef"')
      && promptText.includes('"stdoutRef"')
      && promptText.includes('"stderrRef"')
      && promptText.includes('"outputRef"');
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-agentserver-generation-run-2',
          status: 'completed',
          output: {
            result: {
              message: 'The generated task code is under .sciforge/tasks/generated-literature.py and the executed archive/output/log refs are listed in recentExecutionRefs.',
              confidence: 0.9,
              claimType: 'context-answer',
              evidenceLevel: 'agentserver-context',
              reasoningTrace: 'AgentServer generation endpoint answered from existing context without a separate SciForge intent route.',
              claims: [],
              uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }],
              executionUnits: [{
                id: 'agentserver-direct-context',
                tool: 'agentserver.direct-context',
                status: 'done',
              }],
              artifacts: [{
                id: 'research-report',
                type: 'research-report',
                schemaVersion: '1',
                data: {
                  markdown: 'The generated task code is under .sciforge/tasks/generated-literature.py and the executed archive/output/log refs are listed in recentExecutionRefs.',
                },
              }],
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
    return;
  }
  if (promptText.includes('Continue from prior refs')) {
    assert.equal(metadata.contextMode, 'full');
    sawFullContextFallback = promptText.includes('"mode": "full"')
      && promptText.includes('"workspaceTreeSummary"')
      && promptText.includes('"decisionOwner": "AgentServer"')
      && promptText.includes('"agentServerCoreSnapshotAvailable": false')
      && promptText.includes('"currentUserRequest": "Continue from prior refs even when AgentServer Core context is temporarily unavailable."');
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-agentserver-generation-run-3',
          status: 'completed',
          output: {
            result: {
              message: 'Continued from full SciForge handoff after AgentServer Core context was unavailable.',
              confidence: 0.91,
              claimType: 'context-answer',
              evidenceLevel: 'agentserver-full-handoff',
              reasoningTrace: 'AgentServer received full handoff instead of delta context.',
              claims: [],
              uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }],
              executionUnits: [{
                id: 'agentserver-full-context-fallback',
                tool: 'agentserver.direct-context',
                status: 'done',
              }],
              artifacts: [{
                id: 'research-report',
                type: 'research-report',
                schemaVersion: '1',
                data: {
                  markdown: 'Full SciForge context handoff preserved prior refs while AgentServer Core context was unavailable.',
                },
              }],
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
    return;
  }
  sawGenerationRequest = true;

  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-generation-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [
              {
                path: '.sciforge/tasks/generated-literature.py',
                language: 'python',
                content: generatedTask,
              },
            ],
            entrypoint: {
              language: 'python',
              path: '.sciforge/tasks/generated-literature.py',
            },
            environmentRequirements: {
              language: 'python',
            },
            validationCommand: 'python .sciforge/tasks/generated-literature.py <input> <output>',
            expectedArtifacts: ['paper-list'],
            patchSummary: 'Generated a literature fallback task for smoke validation.',
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
      sessionId: 'session-smoke-context',
      currentPrompt: 'custom literature request that intentionally bypasses local skills',
      recentConversation: ['user: create a generated literature task'],
      forceAgentServerGeneration: true,
      scopeCheck: {
        inScope: false,
        handoffTargets: ['knowledge'],
      },
    },
  });

  assert.equal(sawGenerationRequest, true);
  assert.equal(sawLeakedOlderAttempt, false);
  assert.equal(sawContextEnvelope, true);
  const generatedPaperArtifact = result.artifacts.find((artifact) => artifact.type === 'paper-list');
  assert.ok(generatedPaperArtifact);
  const generatedArtifactMetadata = isRecord(generatedPaperArtifact.metadata) ? generatedPaperArtifact.metadata : {};
  const generatedArtifactRef = String(generatedArtifactMetadata.artifactRef);
  assert.match(
    generatedArtifactRef,
    /^\.sciforge\/sessions\/\d{4}-\d{2}-\d{2}_literature_session-smoke-context\/artifacts\/paper-list-artifact\.generated\.paper-list-/,
  );
  assert.equal(typeof generatedArtifactMetadata.outputRef, 'string');
  assert.equal(result.executionUnits.length, 1);
  assert.equal(result.executionUnits[0].status, 'done');
  assert.equal(result.executionUnits[0].agentServerGenerated, true);
  assert.equal(result.executionUnits[0].agentServerRunId, 'mock-agentserver-generation-run');
  assert.match(String(result.reasoningTrace), /AgentServer generation run/);
  assert.match(String(result.reasoningTrace), /Generated a literature fallback task/);

  const rootAttemptFiles = await readdir(join(workspace, '.sciforge', 'task-attempts'));
  const sessionBundleRef = generatedArtifactRef.slice(0, generatedArtifactRef.indexOf('/artifacts/'));
  const sessionAttemptDir = join(workspace, sessionBundleRef, 'records', 'task-attempts');
  const sessionAttemptFiles = await readdir(sessionAttemptDir);
  assert.match(await readFile(join(workspace, generatedArtifactRef), 'utf8'), /paper-list/);
  assert.equal(rootAttemptFiles.length + sessionAttemptFiles.length, 2);
  assert.ok(rootAttemptFiles.includes('prior-generation-failure.json'));
  const generatedAttemptFile = sessionAttemptFiles.find((file) => file.startsWith('generated-literature-'));
  assert.ok(generatedAttemptFile);
  const attemptHistory = JSON.parse(await readFile(join(sessionAttemptDir, generatedAttemptFile), 'utf8'));
  assert.equal(attemptHistory.attempts.length, 1);
  assert.equal(attemptHistory.attempts[0].status, 'done');
  assert.match(
    attemptHistory.attempts[0].codeRef,
    /^\.sciforge\/sessions\/\d{4}-\d{2}-\d{2}_literature_session-smoke-context\/tasks\/generated-literature-[a-f0-9]+\/generated-literature\.py$/,
  );
  await assert.rejects(readFile(join(workspace, '.sciforge', 'tasks', 'generated-literature.py'), 'utf8'));
  assert.equal(await readFile(join(workspace, attemptHistory.attempts[0].codeRef), 'utf8'), generatedTask);

  const continuation = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Where did the generated files go?',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    artifacts: result.artifacts as Array<Record<string, unknown>>,
    uiState: {
      sessionId: 'session-smoke-context',
      currentPrompt: 'Where did the generated files go?',
      recentConversation: [
        'user: create a generated literature task',
        'assistant: generated task code and produced a paper-list artifact',
        'user: Where did the generated files go?',
      ],
      recentExecutionRefs: [attemptHistory.attempts[0]],
      forceAgentServerGeneration: true,
    },
  });

  assert.notEqual(continuation.executionUnits[0].tool, 'sciforge.context-ref-inspector');
  assert.equal(continuation.executionUnits[0].status, 'done');
  assert.match(continuation.message, /generated-literature/);

  contextEndpointUnavailable = true;
  const fallbackContinuation = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Continue from prior refs even when AgentServer Core context is temporarily unavailable.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['research-report'],
    artifacts: result.artifacts as Array<Record<string, unknown>>,
    uiState: {
      sessionId: 'session-smoke-context',
      currentPrompt: 'Continue from prior refs even when AgentServer Core context is temporarily unavailable.',
      recentConversation: [
        'user: create a generated literature task',
        'assistant: generated task code and produced a paper-list artifact',
        'user: Continue from prior refs even when AgentServer Core context is temporarily unavailable.',
      ],
      recentExecutionRefs: [attemptHistory.attempts[0]],
      forceAgentServerGeneration: true,
    },
  });

  assert.equal(fallbackContinuation.executionUnits[0].status, 'done');

  console.log('[ok] agentserver generation smoke writes generated task code, carries refs into turn two through the general generation endpoint, and reuses the session agent key');
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
