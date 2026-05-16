import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { runGeneratedTaskExecutionLifecycle } from './generated-task-runner-execution-lifecycle.js';
import { repairNeededPayload } from './payload-validation.js';

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
  assert.equal(taskInput.taskHelperSdk.moduleName, 'sciforge_task');
  assert.match(taskInput.taskHelperSdk.helperRef, /\/sciforge_task\.py$/);
  assert.match(taskInput.taskHelperSdk.importHint, /invoke_capability/);
  assert.match(taskInput.taskHelperSdk.importHint, /invoke_provider/);
  assert.match(taskInput.taskHelperSdk.importHint, /provider_result_is_empty/);
  assert.match(taskInput.taskHelperSdk.importHint, /empty_result_payload/);
  assert.ok(taskInput.capabilityFirstPolicy.rules.some((line: string) => /provider route/.test(line)));
  assert.ok(taskInput.capabilityFirstPolicy.rules.some((line: string) => /provider_result_is_empty/.test(line)));
  assert.equal(taskInput.providerInvocation.schemaVersion, 'sciforge.generated-task-provider-invocation.v1');
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
  await access(join(workspace, taskInput.taskHelperSdk.helperRef));
  const helperSource = await readFile(join(workspace, taskInput.taskHelperSdk.helperRef), 'utf8');
  assert.match(helperSource, /def provider_result_is_empty/);
  assert.match(helperSource, /def empty_result_payload/);
  assert.match(helperSource, /failed-with-reason/);
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

test('generated task output shape preflight resolves same-file artifact variables before execution', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-preflight-artifact-vars-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'write a report',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-artifact-vars',
      sessionCreatedAt: '2026-05-12T03:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-12T03:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation: {
      ok: true,
      runId: 'run-artifact-vars',
      response: {
        taskFiles: [{
          path: 'tasks/artifact-vars.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'artifact_report = {"ref": "research-report.md", "type": "research-report", "content": "# Report", "mimeType": "text/markdown"}',
            'artifact_papers = {"ref": "paper-list.json", "type": "paper-list", "data": {"papers": []}}',
            'payload = {"message": "ok", "confidence": 0.8, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "read input", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done"}], "artifacts": [artifact_report, artifact_papers], "inputPath": input_path}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/artifact-vars.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report', 'paper-list'],
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
  assert.equal(result.execution.run.exitCode, 0);
  const taskInput = JSON.parse(await readFile(join(workspace, result.execution.inputRel ?? ''), 'utf8'));
  assert.equal(taskInput.generatedTaskPayloadPreflight.status, 'guidance');
  assert.ok(taskInput.generatedTaskPayloadPreflight.issues.every((issue: { severity: string }) => issue.severity === 'guidance'));
  const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
  assert.deepEqual(output.artifacts.map((artifact: { type: string }) => artifact.type), ['research-report', 'paper-list']);
});

test('generated Python task can invoke ready provider through helper adapter', async () => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      output: {
        echoedToolId: body.toolId,
        finalUrl: body.input?.url,
        status: 200,
        text: 'provider bridge ok',
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-invoke-'));
    const request: GatewayRequest = {
      workspacePath: workspace,
      skillDomain: 'literature',
      prompt: 'fetch url with web_fetch provider',
      selectedToolIds: ['web_fetch'],
      artifacts: [],
      uiState: {
        sessionId: 'session-literature-provider-invoke',
        sessionCreatedAt: '2026-05-12T05:00:00.000Z',
        capabilityProviderAvailability: [{
          id: 'sciforge.web-worker.web_fetch',
          available: true,
          status: 'available',
          endpoint,
        }],
      },
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    };
    const skill = {
      id: 'literature-test',
      kind: 'builtin',
      available: true,
      reason: 'test',
      checkedAt: '2026-05-12T05:00:00.000Z',
      manifestPath: 'builtin',
      manifest: {},
    } as unknown as SkillAvailability;

    const result = await runGeneratedTaskExecutionLifecycle({
      workspace,
      request,
      skill,
      generation: {
        ok: true,
        runId: 'run-provider-invoke',
        response: {
          taskFiles: [{
            path: 'tasks/provider-fetch.py',
            language: 'python',
            content: [
              'import sys',
              'from sciforge_task import load_input, write_payload, invoke_provider',
              '_, input_path, output_path = sys.argv',
              'task_input = load_input(input_path)',
              'fetched = invoke_provider(task_input, "web_fetch", {"url": "https://example.com", "maxChars": 50})',
              'payload = {"message": fetched["text"], "confidence": 0.9, "claimType": "observation", "evidenceLevel": "provider", "reasoningTrace": "used invoke_provider web_fetch", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done", "tool": "web_fetch"}], "artifacts": [{"id": "fetch-result", "type": "runtime-context-summary", "data": fetched}]}',
              'write_payload(output_path, payload)',
            ].join('\n'),
          }],
          entrypoint: { language: 'python', path: 'tasks/provider-fetch.py' },
          environmentRequirements: {},
          validationCommand: '',
          expectedArtifacts: ['runtime-context-summary'],
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
    assert.equal(result.execution.run.exitCode, 0);
    const taskInput = JSON.parse(await readFile(join(workspace, result.execution.inputRel ?? ''), 'utf8'));
    assert.equal(taskInput.providerInvocation.adapters[0]?.kind, 'http');
    assert.equal(taskInput.providerInvocation.adapters[0]?.endpoint, endpoint);
    const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
    assert.equal(output.message, 'provider bridge ok');
    assert.equal(output.artifacts[0].data.echoedToolId, 'web_fetch');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('generated task preflight blocks direct network when web provider route is ready', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-first-preflight-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'search latest arxiv papers',
    selectedToolIds: ['web_search'],
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-provider-first',
      sessionCreatedAt: '2026-05-12T04:00:00.000Z',
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_search',
        available: true,
        status: 'available',
      }],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-12T04:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;
  const markerRel = '.sciforge/provider-first-should-not-run.txt';

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation: {
      ok: true,
      runId: 'run-provider-first-preflight',
      response: {
        taskFiles: [{
          path: 'tasks/direct-network.py',
          language: 'python',
          content: [
            'import json, sys',
            'import requests',
            'from pathlib import Path',
            '_, input_path, output_path = sys.argv',
            `Path("${markerRel}").write_text("ran")`,
            'payload = {"message": "ok", "confidence": 0.8, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "bad", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done"}], "artifacts": []}',
            'Path(output_path).write_text(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/direct-network.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    deps: {
      repairNeededPayload: (_request, _skill, reason, context): ToolPayload => ({
        message: reason,
        confidence: 0,
        claimType: 'fact',
        evidenceLevel: 'runtime',
        reasoningTrace: JSON.stringify(context ?? {}),
        claims: [],
        uiManifest: [],
        executionUnits: [],
        artifacts: [],
      }),
    },
  });

  assert.equal(result.kind, 'payload');
  if (result.kind !== 'payload') return;
  assert.match(result.payload.message, /provider route/i);
  assert.match(result.payload.message, /direct external network APIs/i);
  assert.match(result.payload.reasoningTrace, /sciforge_task/);
  assert.match(result.payload.reasoningTrace, /repair-needed ToolPayload/);
  await assert.rejects(access(join(workspace, markerRel)));
});

test('capability-first policy preflight block returns failed-with-reason diagnostic Projection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-first-projection-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'fetch and search current papers through SciForge providers',
    selectedToolIds: ['web_fetch', 'web_search'],
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-provider-first-projection',
      sessionCreatedAt: '2026-05-12T06:00:00.000Z',
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.web_fetch',
        available: true,
        status: 'available',
      }, {
        id: 'sciforge.web-worker.web_search',
        available: true,
        status: 'available',
      }],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const skill = {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt: '2026-05-12T06:00:00.000Z',
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;
  const markerRel = '.sciforge/provider-first-projection-should-not-run.txt';

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation: {
      ok: true,
      runId: 'run-provider-first-projection',
      response: {
        taskFiles: [{
          path: 'tasks/direct-urllib.py',
          language: 'python',
          content: [
            'import json, sys',
            'import urllib.request',
            'from pathlib import Path',
            '_, input_path, output_path = sys.argv',
            `Path("${markerRel}").write_text("ran")`,
            'urllib.request.urlopen("https://example.com")',
            'payload = {"message": "ok", "confidence": 0.8, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "bad", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done"}], "artifacts": []}',
            'Path(output_path).write_text(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/direct-urllib.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
      },
    },
    deps: { repairNeededPayload },
  });

  assert.equal(result.kind, 'payload');
  if (result.kind !== 'payload') return;
  const payload = result.payload;
  const unit = payload.executionUnits[0] as Record<string, any>;
  const diagnostic = payload.artifacts.find((artifact) => artifact.type === 'runtime-diagnostic') as Record<string, any> | undefined;
  const displayIntent = payload.displayIntent as Record<string, any> | undefined;
  const outcome = displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const projection = outcome?.conversationProjection as Record<string, any> | undefined;
  const visibleAnswer = projection?.visibleAnswer as Record<string, any> | undefined;
  const resultPresentation = displayIntent?.resultPresentation as Record<string, any> | undefined;

  assert.equal(payload.claimType, 'runtime-diagnostic');
  assert.equal(unit.status, 'failed-with-reason');
  assert.equal(unit.blocker, 'generated-task-capability-first-policy');
  assert.match(unit.failureReason, /direct external network APIs \(urllib\)/);
  assert.match(unit.failureReason, /web_fetch, web_search/);
  assert.equal(diagnostic?.schemaVersion, 'sciforge.runtime-diagnostic.v1');
  assert.equal(diagnostic?.data?.status, 'failed-with-reason');
  assert.equal(projection?.schemaVersion, 'sciforge.conversation-projection.v1');
  assert.equal(visibleAnswer?.status, 'repair-needed');
  assert.match(String(visibleAnswer?.text), /direct external network APIs \(urllib\)/);
  assert.ok(projection?.diagnostics?.some((entry: Record<string, unknown>) => /urllib/.test(String(entry.message))));
  assert.ok(Array.isArray(resultPresentation?.answerBlocks));
  assert.ok(resultPresentation.answerBlocks.some((block: Record<string, unknown>) => /urllib/.test(String(block.text))));
  assert.ok(Array.isArray(resultPresentation?.diagnosticsRefs));
  await assert.rejects(access(join(workspace, markerRel)));
});
