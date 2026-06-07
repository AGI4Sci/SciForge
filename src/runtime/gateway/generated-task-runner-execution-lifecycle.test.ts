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

function providerTestSkill(checkedAt: string): SkillAvailability {
  return {
    id: 'literature-test',
    kind: 'builtin',
    available: true,
    reason: 'test',
    checkedAt,
    manifestPath: 'builtin',
    manifest: {},
  } as unknown as SkillAvailability;
}

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

test('generated task helper fills omitted optional array envelope fields', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-helper-default-arrays-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'write a compact markdown package',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-helper-default-arrays',
      sessionCreatedAt: '2026-05-12T01:05:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T01:05:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-helper-default-arrays',
      response: {
        taskFiles: [{
          path: 'tasks/write-package.py',
          language: 'python',
          content: [
            'import sys',
            'from sciforge_task import write_payload',
            '_, input_path, output_path = sys.argv',
            'write_payload(output_path, {"message": "ok", "confidence": 0.8, "claimType": "artifact-generation", "evidenceLevel": "runtime", "reasoningTrace": "wrote files"})',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/write-package.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: [],
      },
    },
    deps: { repairNeededPayload },
  });

  assert.equal(result.kind, 'run');
  if (result.kind !== 'run') return;
  assert.equal(result.execution.run.exitCode, 0);
  const payload = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef ?? ''), 'utf8'));
  assert.deepEqual(payload.claims, []);
  assert.deepEqual(payload.uiManifest, []);
  assert.deepEqual(payload.executionUnits, []);
  assert.deepEqual(payload.artifacts, []);
});

test('generated task input carries ready web routes for evidence-matrix artifacts even when model omitted selected tools', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-evidence-matrix-routes-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'build an evidence matrix from current literature',
    artifacts: [],
    expectedArtifactTypes: ['evidence-matrix', 'paper-list'],
    uiState: {
      sessionId: 'session-literature-evidence-routes',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
      capabilityProviderAvailability: [
        { id: 'sciforge.web-worker.web_search', available: true, status: 'available' },
        { id: 'sciforge.web-worker.web_fetch', available: true, status: 'available' },
      ],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T01:00:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-evidence-routes',
      response: {
        taskFiles: [{
          path: 'tasks/inspect-provider-routes.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'task_input = json.load(open(input_path, "r", encoding="utf-8"))',
            'routes = task_input.get("capabilityProviderRoutes", {}).get("routes", [])',
            'payload = {"message": "ok", "confidence": 0.8, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "routes", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done"}], "artifacts": [{"id": "routes", "type": "runtime-context-summary", "data": routes}]}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/inspect-provider-routes.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['evidence-matrix', 'paper-list'],
      },
    },
    deps: {
      repairNeededPayload,
    },
  });

  assert.equal(result.kind, 'run');
  if (result.kind !== 'run') return;
  const taskInput = JSON.parse(await readFile(join(workspace, result.execution.inputRel ?? ''), 'utf8'));
  assert.deepEqual(taskInput.capabilityProviderRoutes.requiredCapabilityIds, ['web_fetch', 'web_search']);
  assert.deepEqual(taskInput.capabilityProviderRoutes.routes.map((route: Record<string, unknown>) => route.capabilityId).sort(), ['web_fetch', 'web_search']);
  assert.deepEqual(taskInput.providerInvocation.adapters.map((adapter: Record<string, unknown>) => adapter.capabilityId).sort(), ['web_fetch', 'web_search']);
});

test('generated Python helper exposes callable capability discovery without treating it as completion evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-discovery-helper-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'discover the right web capability before searching',
    selectedToolIds: ['web_search'],
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-discovery-helper',
      sessionCreatedAt: '2026-05-12T01:30:00.000Z',
      capabilityProviderAvailability: [
        { id: 'sciforge.web-worker.web_search', available: true, status: 'available' },
      ],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T01:30:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-discovery-helper',
      response: {
        taskFiles: [{
          path: 'tasks/discover-capability.py',
          language: 'python',
          content: [
            'import json, sys',
            'from sciforge_task import load_input, write_payload, invoke_capability',
            '_, input_path, output_path = sys.argv',
            'task_input = load_input(input_path)',
            'search = invoke_capability(task_input, "capability_discovery.search", {"goal": "search web", "constraints": {"maxCandidates": 3}})',
            'candidate_ids = [item["capabilityId"] for item in search["candidates"]]',
            'plan = invoke_capability(task_input, "capability_discovery.plan", {"goal": "search web", "candidateIds": candidate_ids})',
            'write_payload(output_path, {',
            '  "message": "Discovery completed but did not execute user work.",',
            '  "confidence": 0.7,',
            '  "claimType": "runtime-diagnostic",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": json.dumps({"search": search, "plan": plan}),',
            '  "claims": [{"id": "discovery-not-evidence", "type": "observation", "text": plan["completionEvidence"], "confidence": 0.9, "evidenceLevel": "runtime", "supportingRefs": [plan["auditRef"]], "opposingRefs": []}],',
            '  "uiManifest": [],',
            '  "executionUnits": [{"id": "capability-discovery", "tool": "capability_discovery.plan", "status": "failed-with-reason", "failureReason": "discovery-is-not-task-completion"}],',
            '  "artifacts": [{"id": "capability-discovery-plan", "type": "runtime-diagnostic", "data": plan}],',
            '})',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/discover-capability.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['runtime-diagnostic'],
      },
    },
    deps: { repairNeededPayload },
  });

  assert.equal(result.kind, 'run');
  if (result.kind !== 'run') return;
  assert.equal(result.execution.run.exitCode, 0);
  const taskInput = JSON.parse(await readFile(join(workspace, result.execution.inputRel ?? ''), 'utf8'));
  assert.match(taskInput.taskHelperSdk.importHint, /capability_discovery_search/);
  const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
  assert.equal(output.artifacts[0]?.data?.completionEvidence, 'not-evidence');
  assert.equal(output.executionUnits[0]?.status, 'failed-with-reason');
  assert.match(output.reasoningTrace, /capability-discovery:search:generated-task/);
  assert.doesNotMatch(output.reasoningTrace, new RegExp('endpoint|baseUrl|invokeUrl|workspaceRoots|auth|token|secret|/Applications/workspace', 'i'));
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

test('generated Python syntax preflight blocks invalid source before executing workspace side effects', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-python-syntax-preflight-'));
  const markerRel = '.sciforge/marker-invalid-python-should-not-run.txt';
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'run a generated data analysis task',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-python-syntax-preflight',
      sessionCreatedAt: '2026-05-12T02:30:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T02:30:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-python-syntax-preflight',
      response: {
        taskFiles: [{
          path: 'tasks/invalid-python.py',
          language: 'python',
          content: [
            'from pathlib import Path',
            `Path("${markerRel}").write_text("ran")`,
            'df´l = 1',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/invalid-python.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['runtime-diagnostic'],
      },
    },
    deps: { repairNeededPayload },
  });

  assert.equal(result.kind, 'payload');
  if (result.kind !== 'payload') return;
  assert.match(result.payload.message, /Generated Python entrypoint failed syntax preflight before execution/i);
  assert.equal(result.payload.executionUnits[0]?.status, 'failed-with-reason');
  assert.match(JSON.stringify(result.payload), /generated-task-python-syntax-preflight/);
  await assert.rejects(access(join(workspace, markerRel)));
});

test('generated Python syntax preflight attempts bounded repair before returning terminal payload', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-python-syntax-preflight-repair-'));
  const markerRel = '.sciforge/marker-invalid-python-repair-should-not-run.txt';
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'debug a generated paper reproduction task',
    artifacts: [],
    uiState: {
      sessionId: 'session-literature-python-syntax-preflight-repair',
      sessionCreatedAt: '2026-05-12T02:35:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  let repairAttempted = false;

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T02:35:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-python-syntax-preflight-repair',
      response: {
        taskFiles: [{
          path: 'tasks/invalid-python-repair.py',
          language: 'python',
          content: [
            'from pathlib import Path',
            `Path("${markerRel}").write_text("ran")`,
            'value =',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/invalid-python-repair.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['runtime-diagnostic'],
      },
    },
    deps: {
      repairNeededPayload,
      attemptPlanRefs: () => ({}),
      tryGeneratedTaskRepairAndRerun: async (params) => {
        repairAttempted = true;
        assert.match(params.failureReason, /Generated Python entrypoint failed syntax preflight/i);
        assert.match(params.run.stderr, /Generated Python entrypoint failed syntax preflight/i);
        assert.equal(params.run.exitCode, 1);
        assert.match(params.run.spec.taskRel, /invalid-python-repair\.py$/);
        await access(join(workspace, params.run.spec.taskRel));
        await access(join(workspace, params.run.stderrRef));
        return {
          message: 'Repair rerun completed after regenerating parseable task code.',
          confidence: 0.82,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          reasoningTrace: 'bounded repair rerun',
          claims: [],
          uiManifest: [],
          executionUnits: [{ id: 'EU-repair', tool: 'agentserver.repair', status: 'done' }],
          artifacts: [],
        };
      },
    },
  });

  assert.equal(repairAttempted, true);
  assert.equal(result.kind, 'payload');
  if (result.kind !== 'payload') return;
  assert.match(result.payload.message, /Repair rerun completed/);
  assert.doesNotMatch(result.payload.message, /syntax preflight before execution/i);
  assert.equal(result.payload.executionUnits[0]?.status, 'done');
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

test('generated Python task receives a node CLI adapter for Playwright Edge MCP routes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-playwright-edge-adapter-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Open a visible Microsoft Edge browser and read https://example.com.',
    selectedToolIds: ['playwright_edge_browser'],
    artifacts: [],
    uiState: {
      sessionId: 'session-playwright-edge-adapter',
      sessionCreatedAt: '2026-05-12T05:05:00.000Z',
      capabilityProviderAvailability: [{
        id: 'sciforge.observe.playwright-edge-mcp',
        providerId: 'sciforge.observe.playwright-edge-mcp',
        capabilityId: 'playwright_edge_browser',
        source: 'mcp',
        transport: 'mcp',
        available: true,
        status: 'available',
        url: 'http://localhost:8931/mcp',
      }],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T05:05:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-playwright-edge-adapter',
      response: {
        taskFiles: [{
          path: 'tasks/playwright-edge-adapter.py',
          language: 'python',
          content: [
            'import sys',
            'from sciforge_task import load_input, write_payload',
            '_, input_path, output_path = sys.argv',
            'task_input = load_input(input_path)',
            'adapter = task_input["providerInvocation"]["adapters"][0]',
            'payload = {"message": adapter["kind"], "confidence": 0.9, "claimType": "runtime-diagnostic", "evidenceLevel": "provider", "reasoningTrace": "inspected playwright edge adapter", "claims": [], "uiManifest": [], "executionUnits": [{"id": "unit", "status": "done", "tool": "playwright_edge_browser"}], "artifacts": [{"id": "adapter", "type": "runtime-context-summary", "data": adapter}]}',
            'write_payload(output_path, payload)',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/playwright-edge-adapter.py' },
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
  const adapter = taskInput.providerInvocation.adapters[0];
  assert.equal(adapter.kind, 'node-cli');
  assert.equal(adapter.providerId, 'sciforge.observe.playwright-edge-mcp');
  assert.ok(adapter.argsPrefix.some((arg: string) => /playwright-edge-provider-cli\.ts$/.test(arg)));
  assert.deepEqual(adapter.argsPrefix.slice(-3), ['invoke', '--mcp-url', 'http://localhost:8931/mcp']);
});

test('generated Python task turns empty provider output into terminal empty-result payload', async () => {
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      output: { results: [], totalResults: 0 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-empty-'));
    const request: GatewayRequest = {
      workspacePath: workspace,
      skillDomain: 'literature',
      prompt: 'search through ready provider and report empty honestly',
      selectedToolIds: ['web_search'],
      artifacts: [],
      uiState: {
        sessionId: 'session-literature-provider-empty',
        sessionCreatedAt: '2026-05-12T05:10:00.000Z',
        capabilityProviderAvailability: [{
          id: 'sciforge.web-worker.web_search',
          available: true,
          status: 'available',
          endpoint,
        }],
      },
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    };
    const skill = providerTestSkill('2026-05-12T05:10:00.000Z');

    const result = await runGeneratedTaskExecutionLifecycle({
      workspace,
      request,
      skill,
      generation: {
        ok: true,
        runId: 'run-provider-empty',
        response: {
          taskFiles: [{
            path: 'tasks/provider-empty.py',
            language: 'python',
            content: [
              'import sys',
              'from sciforge_task import load_input, write_payload, invoke_capability, provider_result_is_empty, empty_result_payload',
              '_, input_path, output_path = sys.argv',
              'task_input = load_input(input_path)',
              'result = invoke_capability(task_input, "web_search", {"query": "intentionally narrow query"})',
              'if provider_result_is_empty(result):',
              '    write_payload(output_path, empty_result_payload("web_search", "Provider route completed with zero results.", refs=["runtime://capability-provider-route/web_search"]))',
              'else:',
              '    write_payload(output_path, {"message": "unexpected non-empty", "confidence": 0.9, "claimType": "observation", "evidenceLevel": "provider", "reasoningTrace": "non-empty", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []})',
            ].join('\n'),
          }],
          entrypoint: { language: 'python', path: 'tasks/provider-empty.py' },
          environmentRequirements: {},
          validationCommand: '',
          expectedArtifacts: ['runtime-diagnostic'],
        },
      },
      deps: { repairNeededPayload },
    });

    assert.equal(result.kind, 'run');
    if (result.kind !== 'run') return;
    assert.equal(result.execution.run.exitCode, 0);
    const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
    assert.match(output.message, /zero results/);
    assert.equal(output.evidenceLevel, 'provider');
    assert.equal(output.executionUnits[0]?.status, 'failed-with-reason');
    assert.equal(output.executionUnits[0]?.failureReason, 'empty-results');
    assert.ok(output.executionUnits[0]?.recoverActions.some((action: string) => /Refine|broaden/.test(action)));
    assert.deepEqual(output.claims[0]?.supportingRefs, ['runtime://capability-provider-route/web_search']);
    assert.equal(output.artifacts[0]?.type, 'runtime-diagnostic');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('generated Python task writes failed-with-reason when provider invocation is unavailable', async () => {
  const server = createServer(async (_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: { message: 'provider temporarily unavailable' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-unavailable-'));
    const request: GatewayRequest = {
      workspacePath: workspace,
      skillDomain: 'literature',
      prompt: 'search through ready provider and fail closed if unavailable',
      selectedToolIds: ['web_search'],
      artifacts: [],
      uiState: {
        sessionId: 'session-literature-provider-unavailable',
        sessionCreatedAt: '2026-05-12T05:20:00.000Z',
        capabilityProviderAvailability: [{
          id: 'sciforge.web-worker.web_search',
          available: true,
          status: 'available',
          endpoint,
        }],
      },
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    };
    const skill = providerTestSkill('2026-05-12T05:20:00.000Z');

    const result = await runGeneratedTaskExecutionLifecycle({
      workspace,
      request,
      skill,
      generation: {
        ok: true,
        runId: 'run-provider-unavailable',
        response: {
          taskFiles: [{
            path: 'tasks/provider-unavailable.py',
            language: 'python',
            content: [
              'import sys',
              'from sciforge_task import load_input, write_payload, invoke_capability, ProviderInvocationError',
              '_, input_path, output_path = sys.argv',
              'task_input = load_input(input_path)',
              'try:',
              '    invoke_capability(task_input, "web_search", {"query": "provider unavailable"})',
              'except ProviderInvocationError as error:',
              '    write_payload(output_path, {',
              '        "message": str(error),',
              '        "confidence": 0,',
              '        "claimType": "runtime-diagnostic",',
              '        "evidenceLevel": "provider",',
              '        "reasoningTrace": "ProviderInvocationError via invoke_capability; no direct network fallback.",',
              '        "claims": [],',
              '        "uiManifest": [],',
              '        "executionUnits": [{"id": "provider-call", "tool": "invoke_capability", "status": "failed-with-reason", "failureReason": str(error), "recoverActions": ["Retry the same provider route after health recovers."]}],',
              '        "artifacts": [{"id": "provider-unavailable", "type": "runtime-diagnostic", "data": {"refs": ["runtime://capability-provider-route/web_search"]}}],',
              '    })',
              'else:',
              '    write_payload(output_path, {"message": "unexpected success", "confidence": 0.9, "claimType": "observation", "evidenceLevel": "provider", "reasoningTrace": "unexpected", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []})',
            ].join('\n'),
          }],
          entrypoint: { language: 'python', path: 'tasks/provider-unavailable.py' },
          environmentRequirements: {},
          validationCommand: '',
          expectedArtifacts: ['runtime-diagnostic'],
        },
      },
      deps: { repairNeededPayload },
    });

    assert.equal(result.kind, 'run');
    if (result.kind !== 'run') return;
    assert.equal(result.execution.run.exitCode, 0);
    const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
    assert.match(output.message, /HTTP 503|provider temporarily unavailable/);
    assert.equal(output.executionUnits[0]?.tool, 'invoke_capability');
    assert.equal(output.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(output.reasoningTrace, /no direct network fallback/);
    assert.doesNotMatch(JSON.stringify(output), /requests\.get|urllib\.request|socket\.create_connection/);
    assert.deepEqual(output.artifacts[0]?.data?.refs, ['runtime://capability-provider-route/web_search']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('generated Python helper converts command provider timeout into ProviderInvocationError', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-provider-timeout-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Extract PDF text with the ready provider.',
    selectedToolIds: ['pdf_extract'],
    artifacts: [],
    uiState: {
      sessionId: 'session-provider-timeout',
      sessionCreatedAt: '2026-05-12T05:25:00.000Z',
      capabilityProviderAvailability: [{
        id: 'sciforge.web-worker.pdf_extract',
        providerId: 'sciforge.web-worker.pdf_extract',
        capabilityId: 'pdf_extract',
        workerId: 'sciforge.web-worker',
        available: true,
        status: 'available',
      }],
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };

  const result = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill: providerTestSkill('2026-05-12T05:25:00.000Z'),
    generation: {
      ok: true,
      runId: 'run-provider-timeout',
      response: {
        taskFiles: [{
          path: 'tasks/provider-timeout.py',
          language: 'python',
          content: [
            'import sys',
            'from sciforge_task import load_input, write_payload, invoke_capability, ProviderInvocationError',
            '_, input_path, output_path = sys.argv',
            'task_input = load_input(input_path)',
            'try:',
            '    invoke_capability(task_input, "pdf_extract", {"url": "https://arxiv.org/pdf/2605.16024"}, timeout_seconds=0.001)',
            'except ProviderInvocationError as error:',
            '    write_payload(output_path, {"message": str(error), "confidence": 0, "claimType": "runtime-diagnostic", "evidenceLevel": "provider", "reasoningTrace": "timeout converted to ProviderInvocationError", "claims": [], "uiManifest": [], "executionUnits": [{"id": "provider-call", "tool": "invoke_capability", "status": "failed-with-reason", "failureReason": str(error)}], "artifacts": []})',
            'else:',
            '    write_payload(output_path, {"message": "unexpected success", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []})',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: 'tasks/provider-timeout.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['runtime-diagnostic'],
      },
    },
    deps: { repairNeededPayload },
  });

  assert.equal(result.kind, 'run');
  if (result.kind !== 'run') return;
  assert.equal(result.execution.run.exitCode, 0);
  const output = JSON.parse(await readFile(join(workspace, result.execution.run.outputRef), 'utf8'));
  assert.match(output.message, /pdf_extract CLI timed out/);
  assert.equal(output.executionUnits[0]?.status, 'failed-with-reason');
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
