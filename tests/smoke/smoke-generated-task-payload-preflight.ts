import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateGeneratedTaskPayloadPreflight } from '../../src/runtime/gateway/direct-answer-payload.js';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { makeGeneratedTaskRunnerDeps, runtimeGatewaySkill } from './runtime-gateway-runner-fixtures.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-task-payload-preflight-'));
const request = normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: 'Run a generated task payload preflight smoke.',
  workspacePath: workspace,
  agentServerBaseUrl: 'http://agentserver.local',
  expectedArtifactTypes: ['research-report'],
  uiState: { sessionId: 'payload-preflight-smoke' },
});
const skill = runtimeGatewaySkill();

const malformedSource = [
  'import json, pathlib, sys',
  '_, input_path, output_path = sys.argv',
  'pathlib.Path("should-not-run.txt").write_text("runner executed", encoding="utf-8")',
  'output = {',
  '  "answer": "This is not a ToolPayload envelope.",',
  '  "uiManifest": {"componentId": "report-viewer"},',
  '  "executionUnits": {"id": "run", "status": "done"},',
  '  "artifacts": [{"data": {"markdown": "# Missing id and type"}}]',
  '}',
  'open(output_path, "w", encoding="utf-8").write(json.dumps(output))',
].join('\n');

const report = evaluateGeneratedTaskPayloadPreflight({
  taskFiles: [{ path: '.sciforge/tasks/malformed-output.py', language: 'python', content: malformedSource }],
  entrypoint: { path: '.sciforge/tasks/malformed-output.py' },
  expectedArtifacts: ['research-report'],
  request,
});
assert.equal(report.status, 'blocked');
assert.ok(report.issues.some((issue) => issue.path.includes('message')));
assert.ok(report.issues.some((issue) => issue.path === 'executionUnits'));
assert.ok(report.issues.some((issue) => issue.path.includes('artifacts[0].id')));
assert.ok(report.guidance.some((line) => /ToolPayload envelope/.test(line)));

const objectUiManifest = evaluateGeneratedTaskPayloadPreflight({
  taskFiles: [{
    path: '.sciforge/tasks/object-ui-manifest.py',
    language: 'python',
    content: [
      'import json, sys',
      '_, input_path, output_path = sys.argv',
      'payload = {',
      '  "message": "ok",',
      '  "confidence": 0.5,',
      '  "claimType": "fact",',
      '  "evidenceLevel": "runtime",',
      '  "reasoningTrace": "smoke",',
      '  "claims": [],',
      '  "uiManifest": {"componentId": "report-viewer", "artifactRef": "report"},',
      '  "executionUnits": [{"id": "run", "status": "done"}],',
      '  "artifacts": [{"id": "report", "type": "research-report", "data": {"markdown": "ok"}}]',
      '}',
      'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
    ].join('\n'),
  }],
  entrypoint: { path: '.sciforge/tasks/object-ui-manifest.py' },
});
assert.equal(objectUiManifest.status, 'blocked');
assert.ok(objectUiManifest.issues.some((issue) => issue.path === 'uiManifest'));

const paramsJsonDumps = evaluateGeneratedTaskPayloadPreflight({
  taskFiles: [{
    path: '.sciforge/tasks/params-json-dumps.py',
    language: 'python',
    content: [
      'import json, sys',
      '_, input_path, output_path = sys.argv',
      'payload = {}',
      'payload["message"] = "ok"',
      'payload["confidence"] = 0.8',
      'payload["claimType"] = "fact"',
      'payload["evidenceLevel"] = "runtime"',
      'payload["reasoningTrace"] = "smoke"',
      'payload["claims"] = []',
      'payload["uiManifest"] = []',
      'payload["executionUnits"] = [{"id": "run", "status": "done", "params": json.dumps({"expected": ["research-report"]})}]',
      'payload["artifacts"] = [{"id": "report", "type": "research-report", "data": {"markdown": "ok"}}]',
      'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
    ].join('\n'),
  }],
  entrypoint: { path: '.sciforge/tasks/params-json-dumps.py' },
});
assert.equal(paramsJsonDumps.status, 'ready');

const payload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
  request,
  requestAgentServerGeneration: async () => ({
    ok: true,
    runId: 'payload-preflight-run',
    response: {
      taskFiles: [{
        path: '.sciforge/tasks/malformed-output.py',
        language: 'python',
        content: malformedSource,
      }],
      entrypoint: { language: 'python', path: '.sciforge/tasks/malformed-output.py' },
      environmentRequirements: {},
      validationCommand: '',
      expectedArtifacts: ['research-report'],
    },
  }),
}));

assert.equal(payload?.executionUnits[0]?.status, 'repair-needed');
assert.match(payload?.message ?? '', /payload preflight blocked expensive execution/i);
assert.match(JSON.stringify(payload?.executionUnits[0]?.refs ?? {}), /generatedTaskPayloadPreflight/);
await assert.rejects(access(join(workspace, 'should-not-run.txt')));

const taskRef = String(payload?.executionUnits[0]?.codeRef ?? '');
assert.match(taskRef, /^\.sciforge\/sessions\/.+\/tasks\/generated-literature-/);
assert.match(await readFile(join(workspace, taskRef), 'utf8'), /This is not a ToolPayload envelope/);

console.log(JSON.stringify({
  ok: true,
  workspace,
  blockedIssues: report.issues.map((issue) => issue.path),
  taskRef,
}, null, 2));
