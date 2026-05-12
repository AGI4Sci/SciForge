import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { runGeneratedTaskExecutionLifecycle } from './generated-task-runner-execution-lifecycle.js';

test('generated task files are materialized only inside the session bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-session-bundle-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'read one agent paper',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-1',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-12T01:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation: {
      ok: true,
      runId: 'run-1',
      response: {
        taskFiles: [{
          path: 'tasks/arxiv-agent-paper-review.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'with open(output_path, "w", encoding="utf-8") as f:',
            '    json.dump({"message": "ok", "confidence": 0.8, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "read input", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done"}], "artifacts": [], "inputPath": input_path}, f)',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/arxiv-agent-paper-review.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    deps: {
      repairNeededPayload: (_request, _skill, reason): ToolPayload => ({
        message: reason,
        confidence: 0,
        claimType: 'fact',
        evidenceLevel: 'runtime',
        reasoningTrace: reason,
        claims: [],
        uiManifest: [],
        executionUnits: [],
        artifacts: [],
      }),
    },
  });

  assert.equal(result.kind, 'run');
  if (result.kind !== 'run') return;
  const { inputRel, taskRel } = result.execution;
  const outputRef = result.execution.run.outputRef;
  assert.ok(inputRel);
  assert.ok(taskRel);
  assert.ok(outputRef);
  assert.equal(result.execution.run.exitCode, 0);
  assert.match(taskRel, /^\.sciforge\/sessions\/2026-05-12_literature-evidence-review_session-literature-1\/tasks\/generated-literature-/);
  assert.match(inputRel, /^\.sciforge\/sessions\/2026-05-12_literature-evidence-review_session-literature-1\/task-inputs\/generated-literature-/);
  const taskInput = JSON.parse(await readFile(join(workspace, inputRel), 'utf8'));
  assert.equal(taskInput.generatedTaskPayloadPreflight.status, 'ready');
  assert.deepEqual(taskInput.generatedTaskPayloadPreflight.requiredEnvelopeKeys, ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts']);
  assert.ok(taskInput.generatedTaskPayloadPreflight.guidance.some((line: string) => /ToolPayload envelope/.test(line)));
  assert.deepEqual(JSON.parse(await readFile(join(workspace, outputRef), 'utf8')), {
    message: 'ok',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'read input',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'unit', status: 'done' }],
    artifacts: [],
    inputPath: join(workspace, inputRel),
  });
  await assert.rejects(access(join(workspace, 'tasks/arxiv-agent-paper-review.py')));
  await access(join(workspace, taskRel));
});

test('generated task output shape preflight blocks obvious malformed payload writers before execution', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-preflight-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'download many PDFs and write a report',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-preflight',
      sessionCreatedAt: '2026-05-12T02:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-12T02:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;
  const markerRel = '.sciforge/marker-should-not-run.txt';

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation: {
      ok: true,
      runId: 'run-preflight',
      response: {
        taskFiles: [{
          path: 'tasks/malformed-output-writer.py',
          language: 'python',
          content: [
            'from pathlib import Path',
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            `Path("${markerRel}").write_text("ran")`,
            'payload = {"message": "bad", "confidence": 0.1, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "bad", "claims": [], "uiManifest": {"componentId": "report-viewer", "artifactRef": "report"}, "executionUnits": [], "artifacts": []}',
            'Path(output_path).write_text(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/malformed-output-writer.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    deps: {
      repairNeededPayload: (_request, _skill, reason): ToolPayload => ({
        message: reason,
        confidence: 0,
        claimType: 'fact',
        evidenceLevel: 'runtime',
        reasoningTrace: reason,
        claims: [],
        uiManifest: [],
        executionUnits: [],
        artifacts: [],
      }),
    },
  });

  assert.equal(result.kind, 'payload');
  if (result.kind !== 'payload') return;
  assert.match(result.payload.message, /preflight blocked .*execution/i);
  assert.match(result.payload.message, /object-shaped|uiManifest must be an array/i);
  await assert.rejects(access(join(workspace, markerRel)));
});
