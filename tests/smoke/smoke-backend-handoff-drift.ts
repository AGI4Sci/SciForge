import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BACKEND_HANDOFF_DRIFT_EVENT_TYPE,
  type BackendHandoffDriftClassification,
} from '../../packages/contracts/runtime/backend-handoff-drift.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-backend-handoff-drift-'));

await runDriftCase({
  name: 'task-files',
  prompt: 'Run a generated taskFiles handoff.',
  response: () => generationRun('mock-task-files-run', 'task-files-report', 'TaskFiles handoff executed.'),
  expectedKinds: ['task-files'],
  assertResult: (result) => {
    assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.handoff-drift'));
    assert.ok(result.artifacts.some((artifact) => artifact.id === 'task-files-report'));
  },
});

await runDriftCase({
  name: 'direct-tool-payload',
  prompt: 'Return a direct ToolPayload handoff.',
  response: () => directPayloadRun('mock-direct-payload-run'),
  expectedKinds: ['direct-tool-payload'],
  assertResult: (result) => {
    assert.equal(result.message, 'Direct ToolPayload handoff completed.');
    assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.direct-payload-smoke'));
  },
});

await runDriftCase({
  name: 'plain-text-answer',
  prompt: 'Return a plain text handoff report.',
  response: () => plainTextRun('mock-plain-text-run'),
  expectedKinds: ['plain-text-answer'],
  assertResult: (result) => {
    assert.ok(result.artifacts.some((artifact) => artifact.type === 'research-report'));
    assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.direct-text'));
  },
});

let malformedAttempt = 0;
await runDriftCase({
  name: 'malformed-generation-response',
  prompt: 'Recover a malformed generation-looking handoff.',
  response: () => {
    malformedAttempt += 1;
    if (malformedAttempt === 1) return malformedGenerationTextRun('mock-malformed-generation-run');
    return generationRun('mock-malformed-retry-run', 'malformed-retry-report', 'Strict retry task executed.');
  },
  expectedKinds: ['malformed-generation-response', 'task-files'],
  assertResult: (result) => {
    assert.ok(result.artifacts.some((artifact) => artifact.id === 'malformed-retry-report'));
    assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.status === 'done'));
  },
});

console.log('[ok] backend handoff drift classifies taskFiles, direct ToolPayload, plain text, and malformed generation retry paths');

async function runDriftCase(input: {
  name: string;
  prompt: string;
  response: () => Record<string, unknown>;
  expectedKinds: string[];
  assertResult: (result: Awaited<ReturnType<typeof runWorkspaceRuntimeGateway>>) => void;
}) {
  const events: WorkspaceRuntimeEvent[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: `context-${input.name}` }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    await readJson(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result: input.response() })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: input.prompt,
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      availableSkills: ['missing.skill'],
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: ['report-viewer', 'execution-unit-table'],
      uiState: {
        forceAgentServerGeneration: true,
        sessionId: `backend-handoff-${input.name}`,
        expectedArtifactTypes: ['research-report'],
        selectedComponentIds: ['report-viewer', 'execution-unit-table'],
      },
      artifacts: [],
    }, {
      onEvent: (event) => events.push(event),
    });
    input.assertResult(result);
    const classifications = events
      .filter((event) => event.type === BACKEND_HANDOFF_DRIFT_EVENT_TYPE)
      .map((event) => event.raw)
      .filter(isBackendHandoffDriftClassification);
    for (const kind of input.expectedKinds) {
      assert.ok(
        classifications.some((classification) => classification.kind === kind),
        `${input.name} should emit backend handoff drift kind=${kind}; saw ${classifications.map((item) => item.kind).join(', ')}`,
      );
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function generationRun(runId: string, artifactId: string, markdown: string) {
  const taskPath = `.sciforge/tasks/${artifactId}/generated.py`;
  const code = [
    'import json',
    'import sys',
    'output_path = sys.argv[2]',
    'payload = {',
    `  "message": ${JSON.stringify(markdown)},`,
    '  "confidence": 0.82,',
    '  "claimType": "handoff-drift-smoke",',
    '  "evidenceLevel": "runtime",',
    '  "reasoningTrace": "Generated taskFiles handoff drift smoke.",',
    '  "claims": [],',
    `  "uiManifest": [{"componentId": "report-viewer", "artifactRef": ${JSON.stringify(artifactId)}}],`,
    '  "executionUnits": [{"id": "handoff-drift-task", "status": "done", "tool": "agentserver.handoff-drift"}],',
    `  "artifacts": [{"id": ${JSON.stringify(artifactId)}, "type": "research-report", "data": {"markdown": ${JSON.stringify(markdown)}}}]`,
    '}',
    'with open(output_path, "w", encoding="utf-8") as handle:',
    '    json.dump(payload, handle, indent=2)',
  ].join('\n');
  return {
    ok: true,
    data: {
      run: {
        id: runId,
        status: 'completed',
        output: {
          success: true,
          result: {
            taskFiles: [{ path: taskPath, language: 'python', content: code }],
            entrypoint: { path: taskPath, language: 'python' },
            environmentRequirements: { language: 'python' },
            validationCommand: `python ${taskPath} <input> <output>`,
            expectedArtifacts: ['research-report'],
          },
        },
      },
    },
  };
}

function directPayloadRun(runId: string) {
  return {
    ok: true,
    data: {
      run: {
        id: runId,
        status: 'completed',
        output: {
          success: true,
          result: {
            message: 'Direct ToolPayload handoff completed.',
            confidence: 0.9,
            claimType: 'handoff-drift-smoke',
            evidenceLevel: 'agentserver-direct',
            reasoningTrace: 'AgentServer returned a direct ToolPayload.',
            claims: [],
            uiManifest: [{ componentId: 'report-viewer', artifactRef: 'direct-payload-report' }],
            executionUnits: [{ id: 'direct-payload-unit', status: 'done', tool: 'agentserver.direct-payload-smoke' }],
            artifacts: [{
              id: 'direct-payload-report',
              type: 'research-report',
              data: { markdown: 'Direct payload report.' },
            }],
          },
        },
      },
    },
  };
}

function plainTextRun(runId: string) {
  return {
    ok: true,
    data: {
      run: {
        id: runId,
        status: 'completed',
        output: {
          success: true,
          result: [
            '# Plain text handoff report',
            '',
            'AgentServer returned a readable final answer as prose. SciForge should recover it as an audited report artifact.',
          ].join('\n'),
        },
      },
    },
  };
}

function malformedGenerationTextRun(runId: string) {
  return {
    ok: true,
    data: {
      run: {
        id: runId,
        status: 'completed',
        output: {
          success: true,
          result: '```json\n{"taskFiles":[{"path":".sciforge/tasks/malformed/generated.py","language":"python"}], "entrypoint": {}\n```',
        },
      },
    },
  };
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isBackendHandoffDriftClassification(value: unknown): value is BackendHandoffDriftClassification {
  return isRecord(value) && value.schemaVersion === 'sciforge.backend-handoff-drift.v1' && typeof value.kind === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
