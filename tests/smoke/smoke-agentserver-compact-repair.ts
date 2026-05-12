import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRecentTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-compact-repair-'));
let generationRequests = 0;
let repairRequests = 0;
let repairBodyLength = 0;
let repairPromptText = '';

const badTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

print("ALLOWED_STDOUT_SUMMARY")
sys.stderr.write("".join(["BLOCKED", "_STDERR", "_SECRET"]))
raise RuntimeError("intentional compact repair failure before writing output")
`;

const fixedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
with open(input_path, "r", encoding="utf-8") as handle:
  request = json.load(handle)

payload = {
  "message": "Compact AgentServer repair executed the requested task end-to-end.",
  "confidence": 0.9,
  "claimType": "fact",
  "evidenceLevel": "runtime",
  "reasoningTrace": "fixed generated syntax error; reran task after repair",
  "claims": [{
    "id": "claim.compact_repair",
    "text": "Repair requests can stay compact while preserving enough context to fix generated code.",
    "supportingRefs": ["artifact.compact_repair"]
  }],
  "uiManifest": [{
    "componentId": "report-viewer",
    "artifactRef": "artifact.compact_repair"
  }],
  "executionUnits": [{
    "id": "generic-compact-repair",
    "status": "done",
    "tool": "generic.generated.task",
    "params": request.get("prompt", "")[:80]
  }],
  "artifacts": [{
    "id": "artifact.compact_repair",
    "type": "research-report",
    "data": {
      "markdown": "# Compact repair\n\nThe repaired task ran and produced the final artifact."
    }
  }]
}
with open(output_path, "w", encoding="utf-8") as handle:
  json.dump(payload, handle, indent=2)
`;

const hugePrompt = [
  'Generate, execute, repair if needed, and return final research artifacts.',
  'x'.repeat(700_000),
].join('\n');

const server = createServer(async (req, res) => {
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const { parsed, raw } = await readJsonWithRaw(req);
  const metadata = isRecord(parsed.input) && isRecord(parsed.input.metadata) ? parsed.input.metadata : {};
  if (metadata.purpose === 'workspace-task-repair') {
    repairRequests += 1;
    repairBodyLength = raw.length;
    assert.ok(repairBodyLength < 220_000, `repair request should be compact, got ${repairBodyLength} bytes`);
    assert.equal(metadata.contextMode, 'compact-repair');
    assert.equal(metadata.contextEnvelopeBytes, undefined);
    assert.equal(metadata.repairContextVersion, 'sciforge.repair-context.v1');
    const text = isRecord(parsed.input) ? String(parsed.input.text || '') : '';
    const inspectText = await expandCompactedPromptText(text);
    repairPromptText = inspectText;
    assert.match(inspectText, /repairContext/);
    assert.doesNotMatch(inspectText, /x{50000}/, 'repair prompt should not include the full huge user prompt');
    assert.doesNotMatch(inspectText, /BLOCKED_STDERR_SECRET/, 'blocked stderr failure evidence must not leak into repair prompt');
    assert.doesNotMatch(inspectText, /missing executionUnits/, 'validation findings are disabled by repairContextPolicy');
    assert.match(inspectText, /repairContextPolicyAudit/);
    assert.match(inspectText, /"includedFailureEvidenceRefs": \[\s*"stdout"\s*\]/);
    assert.match(inspectText, /"omittedFields"/);
    assert.match(inspectText, /"sourceKind": "contract-handoff"/);
    assert.match(inspectText, /"deterministicDecisionRef"/);
    assert.match(inspectText, /repairContextPolicyIgnoredLegacyAudit/);
    assert.match(inspectText, /"source": "request\.uiState\.repairContextPolicy"/);
    assert.match(inspectText, /"source": "request\.uiState\.capabilityPolicy\.repairContextPolicy"/);
    const codeRef = String(metadata.codeRef || '');
    assert.match(codeRef, /^\.sciforge\/sessions\/.+\/tasks\/generated-literature-/);
    await writeFile(join(workspace, codeRef), fixedTask);
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-compact-repair-run',
          status: 'completed',
          output: { result: 'Fixed syntax error in generated task.' },
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
        id: 'mock-compact-generation-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{
              path: '.sciforge/tasks/compact-repair-syntax-bug.py',
              language: 'python',
              content: badTask,
            }],
            entrypoint: {
              language: 'python',
              path: '.sciforge/tasks/compact-repair-syntax-bug.py',
            },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/compact-repair-syntax-bug.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated a task with an intentional syntax bug.',
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
    prompt: hugePrompt,
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['research-report'],
    uiState: {
      sessionId: 'session-compact-repair',
      forceAgentServerGeneration: true,
      currentPrompt: hugePrompt,
      recentConversation: [hugePrompt],
      agentHarnessHandoff: {
        harnessContractRef: 'runtime://agent-harness/contracts/debug-repair/compact-smoke',
        harnessTraceRef: 'runtime://agent-harness/contracts/debug-repair/compact-smoke/trace',
        repairContextPolicy: {
          kind: 'repair-rerun',
          maxAttempts: 1,
          includeStdoutSummary: true,
          includeStderrSummary: true,
          includeValidationFindings: false,
          includePriorAttemptRefs: false,
          allowedFailureEvidenceRefs: ['stdout'],
          blockedFailureEvidenceRefs: ['stderr', 'validation:findings'],
        },
      },
      repairContextPolicy: {
        kind: 'repair-rerun',
        maxAttempts: 1,
        includeStdoutSummary: false,
        includeStderrSummary: true,
        includeValidationFindings: true,
        allowedFailureEvidenceRefs: ['stderr'],
        blockedFailureEvidenceRefs: ['stdout'],
      },
      capabilityPolicy: {
        repairContextPolicy: {
          includeStdoutSummary: false,
          includeStderrSummary: true,
          allowedFailureEvidenceRefs: ['stderr'],
          blockedFailureEvidenceRefs: ['stdout'],
        },
      },
    },
  });

  assert.equal(generationRequests, 1);
  assert.ok(repairRequests >= 1 && repairRequests <= 2);
  assert.ok(repairBodyLength > 0);
  assert.match(repairPromptText, /"allowedFailureEvidenceRefs": \[\s*"stdout"\s*\]/);
  assert.match(repairPromptText, /"blockedFailureEvidenceRefs": \[\s*"stderr",\s*"validation:findings"\s*\]/);
  assert.match(result.message, /Compact AgentServer repair executed/);
  assert.equal(result.executionUnits[0]?.status, 'self-healed');
  assert.ok(result.artifacts.some((artifact) => artifact.id === 'artifact.compact_repair'));

  const attemptHistory = (await readRecentTaskAttempts(workspace, 'literature', 8))
    .sort((left, right) => left.attempt - right.attempt);
  assert.equal(attemptHistory.length, 2);
  assert.equal(attemptHistory[0].status, 'repair-needed');
  assert.match(attemptHistory[0].failureReason ?? '', /RuntimeError|intentional compact repair failure|schema validation|missing executionUnits/);
  assert.equal(attemptHistory[1].status, 'done');

  console.log('[ok] generated syntax failures use compact AgentServer repair and rerun end-to-end');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readJsonWithRaw(req: NodeJS.ReadableStream): Promise<{ parsed: Record<string, unknown>; raw: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(raw || '{}');
  return { parsed: isRecord(parsed) ? parsed : {}, raw };
}

async function expandCompactedPromptText(text: string) {
  const rawRef = text.match(/rawRef: ([^\n]+)/)?.[1]?.trim();
  if (!rawRef) return text;
  const payload = JSON.parse(await readFile(join(workspace, rawRef), 'utf8'));
  const rawPayload = record(record(payload).payload);
  return String(record(rawPayload.input).text || text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
