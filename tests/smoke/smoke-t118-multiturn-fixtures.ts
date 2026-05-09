import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listSessionArtifacts,
  readArtifact,
  renderArtifact,
  resolveObjectReference,
  resumeRun,
} from '../../src/runtime/backend-artifact-tools.js';
import { coerceAgentServerToolPayload } from '../../src/runtime/gateway/direct-answer-payload.js';
import { runAgentServerGeneratedTask, type GeneratedTaskRunnerDeps } from '../../src/runtime/gateway/generated-task-runner.js';
import { repairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import { firstPayloadFailureReason, payloadHasFailureStatus } from '../../src/runtime/gateway/runtime-routing.js';
import { agentServerGenerationSkill } from '../../src/runtime/skill-registry/fallback.js';
import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';
import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-t118-multiturn-fixtures-'));
await mkdir(join(workspace, '.sciforge', 'task-results'), { recursive: true });
await mkdir(join(workspace, '.sciforge', 'logs'), { recursive: true });
await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
const skill = agentServerGenerationSkill('literature');
const scenarioPackageRef = { id: 't118-multiturn-fixtures', version: '1.0.0', source: 'built-in' as const };
const skillPlanRef = 't118-minimal-multiround';

await writeFile(join(workspace, '.sciforge', 'artifacts', 'session-t118-stale-report.json'), JSON.stringify({
  id: 't118-stale-report',
  type: 'research-report',
  producerScenario: 'literature',
  producerSessionId: 'session-t118-stale',
  schemaVersion: '1',
  data: {
    markdown: '# Stale T118 Report\n\nSHOULD_NOT_USE_STALE_ARTIFACT',
  },
}, null, 2), 'utf8');

const round1 = await runGenerated(roundRequest({
  prompt: 'T118 Round 1: generate a backend research report artifact and persist markdown.',
  sessionId: 'session-t118-round1',
}), round1Task());
assert.ok(round1, 'round 1 should produce a ToolPayload');
const round1Report = artifactById(round1, 't118-round1-report');
assert.ok(round1Report, 'round 1 should include the report artifact');
const round1MarkdownRef = metadataString(round1Report, 'markdownRef');
assert.ok(round1MarkdownRef, 'report artifact should have a materialized markdownRef');
assert.match(await readFile(join(workspace, round1MarkdownRef), 'utf8'), /# T118 Round 1 Report/);
assert.ok(round1.objectReferences?.some((reference) => isRecord(reference) && reference.ref === `file:${round1MarkdownRef}`));
assert.ok(round1.objectReferences?.some((reference) => isRecord(reference) && reference.ref === 'artifact:t118-round1-report'));
assert.equal(round1.objectReferences?.some((reference) => isRecord(reference) && String(reference.ref).startsWith('agentserver://')), false);

const round1Rendered = await renderArtifact({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: 'artifact:t118-round1-report',
  format: 'markdown',
});
assert.equal(round1Rendered.status, 'rendered');
assert.match(round1Rendered.rendered ?? '', /backend capability path/);

const round1MarkdownRead = await readArtifact({
  workspacePath: workspace,
  ref: `file:${round1MarkdownRef}`,
});
assert.equal(round1MarkdownRead.status, 'read');
assert.equal(round1MarkdownRead.mimeType, 'text/markdown');

const listedAfterRound1 = await listSessionArtifacts({
  workspacePath: workspace,
  skillDomain: 'literature',
});
assert.ok(listedAfterRound1.objectReferences.some((reference) => reference.ref === 'artifact:t118-round1-report'));

const currentSessionArtifacts = await listSessionArtifacts({
  workspacePath: workspace,
  sessionId: 'session-t118-round1',
  skillDomain: 'literature',
  artifacts: [round1Report],
});
assert.ok(currentSessionArtifacts.objectReferences.some((reference) => reference.ref === 'artifact:t118-round1-report'));
assert.equal(currentSessionArtifacts.objectReferences.some((reference) => reference.ref === 'artifact:t118-stale-report'), false);

const staleInCurrentSession = await readArtifact({
  workspacePath: workspace,
  sessionId: 'session-t118-round1',
  skillDomain: 'literature',
  ref: 'artifact:t118-stale-report',
});
assert.equal(staleInCurrentSession.status, 'missing');
assert.doesNotMatch(staleInCurrentSession.text ?? '', /SHOULD_NOT_USE_STALE_ARTIFACT/);

const round2 = await runGenerated(roundRequest({
  prompt: 'T118 Round 2: continue only from artifact:t118-round1-report and add a follow-up report section.',
  sessionId: 'session-t118-round2',
  artifacts: [round1Report],
  uiState: {
    currentReferences: [{
      kind: 'artifact',
      ref: 'artifact:t118-round1-report',
      title: 'T118 Round 1 report',
    }],
  },
}), round2Task());
assert.ok(round2, 'round 2 should produce a ToolPayload');
const round2Report = artifactById(round2, 't118-round2-report');
assert.ok(round2Report, 'round 2 should include the continuation artifact');
assert.match(markdownFromArtifact(round2Report), /Continued from artifact:t118-round1-report/);
assert.match(markdownFromArtifact(round2Report), /backend capability path/);
assert.ok(round2.objectReferences?.some((reference) => isRecord(reference) && reference.ref === 'artifact:t118-round2-report'));

const round2Resolved = await resolveObjectReference({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: 'artifact:t118-round2-report',
});
assert.equal(round2Resolved.status, 'resolved');
assert.equal(round2Resolved.reference.kind, 'artifact');

const failedOutputRef = '.sciforge/task-results/t118-failed-run.json';
const failedStdoutRef = '.sciforge/logs/t118-failed-run.stdout.log';
const failedStderrRef = '.sciforge/logs/t118-failed-run.stderr.log';
await writeFile(join(workspace, failedOutputRef), JSON.stringify({
  message: 'Previous generated task failed before report completion.',
  confidence: 0.2,
  claimType: 'failed',
  evidenceLevel: 'workspace-task',
  reasoningTrace: 'T118 failed run fixture.',
  claims: [],
  uiManifest: [],
  executionUnits: [{
    id: 't118-download-and-report',
    status: 'failed-with-reason',
    tool: 'agentserver.generated.python',
    failureReason: 'missing --outputPath',
  }],
  artifacts: [],
}, null, 2), 'utf8');
await writeFile(join(workspace, failedStdoutRef), 'download started\n', 'utf8');
await writeFile(join(workspace, failedStderrRef), 'argparse: missing --outputPath\n', 'utf8');
await appendTaskAttempt(workspace, {
  id: 't118-failed-run',
  prompt: 'T118 repair missing outputPath report run',
  skillDomain: 'literature',
  scenarioPackageRef,
  skillPlanRef,
  skillId: skill.id,
  attempt: 1,
  status: 'failed-with-reason',
  codeRef: '.sciforge/tasks/t118-failed-run.py',
  inputRef: '.sciforge/task-inputs/t118-failed-run.json',
  outputRef: failedOutputRef,
  stdoutRef: failedStdoutRef,
  stderrRef: failedStderrRef,
  exitCode: 2,
  failureReason: 'missing --outputPath',
  createdAt: new Date().toISOString(),
});

const failedRunRead = await readArtifact({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: 'run:t118-failed-run',
});
assert.equal(failedRunRead.status, 'read');
assert.match(failedRunRead.text ?? '', /missing --outputPath/);

const resume = await resumeRun({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: 'run:t118-failed-run',
  reason: 'T118 repair follow-up should use failed run reason.',
});
assert.equal(resume.status, 'resume-requested');
assert.ok(resume.objectReferences.some((reference) => reference.ref === `file:${failedStderrRef}`));

const repaired = await runGenerated(roundRequest({
  prompt: 'T118 Round 3: repair the previous failed run according to its failed run reason and write the report.',
  sessionId: 'session-t118-repair',
  uiState: {
    recentExecutionRefs: [{
      id: 't118-download-and-report',
      status: 'failed-with-reason',
      outputRef: failedOutputRef,
      stdoutRef: failedStdoutRef,
      stderrRef: failedStderrRef,
      failureReason: 'missing --outputPath',
    }],
  },
}), repairFromFailedRunTask());
assert.ok(repaired, 'repair follow-up should produce a ToolPayload');
const repairReport = artifactById(repaired, 't118-repair-report');
assert.ok(repairReport, 'repair follow-up should include a repair report artifact');
assert.match(repaired.message, /missing --outputPath/);
assert.match(markdownFromArtifact(repairReport), /Fixed according to failed run reason: missing --outputPath/);
assert.ok(repaired.objectReferences?.some((reference) => isRecord(reference) && reference.ref === 'artifact:t118-repair-report'));

console.log('[ok] T118 minimal multi-round fixtures use backend generated tasks and object refs for markdown, artifact continuation, and failed-run repair');

async function runGenerated(request: GatewayRequest, response: AgentServerGenerationResponse) {
  return await runAgentServerGeneratedTask(request, skill, [skill], {}, depsFor(response), { allowSupplement: false });
}

function roundRequest(input: {
  prompt: string;
  sessionId: string;
  artifacts?: Array<Record<string, unknown>>;
  uiState?: Record<string, unknown>;
}): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: input.prompt,
    workspacePath: workspace,
    agentServerBaseUrl: 'http://agentserver.t118.local',
    scenarioPackageRef,
    skillPlanRef,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    artifacts: input.artifacts ?? [],
    uiState: {
      sessionId: input.sessionId,
      forceAgentServerGeneration: true,
      ...(input.uiState ?? {}),
    },
  };
}

function depsFor(response: AgentServerGenerationResponse): GeneratedTaskRunnerDeps {
  return {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.t118.local',
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: `mock-${response.entrypoint.path.split('/').pop()?.replace(/\W+/g, '-')}`,
      response,
    }),
    agentServerGenerationFailureReason: (error) => error,
    attemptPlanRefs: (request) => ({ scenarioPackageRef: request.scenarioPackageRef, skillPlanRef: request.skillPlanRef }),
    repairNeededPayload: (request, selectedSkill, reason) => repairNeededPayload(request, selectedSkill, reason),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload, _request, selectedSkill, refs): Promise<ToolPayload> => ({
      ...payload,
      reasoningTrace: [
        payload.reasoningTrace,
        `T118 refs: taskCodeRef=${refs.taskRel} outputRef=${refs.outputRel}`,
      ].filter(Boolean).join('\n'),
      executionUnits: payload.executionUnits.map((unit) => ({
        ...unit,
        skillId: selectedSkill.id,
        outputRef: refs.outputRel,
        stdoutRef: refs.stdoutRel,
        stderrRef: refs.stderrRel,
      })),
      logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
    }),
    tryAgentServerRepairAndRerun: async () => undefined,
    failedTaskPayload: (request, selectedSkill, _run: WorkspaceTaskRunResult, reason) => repairNeededPayload(request, selectedSkill, reason || 'generated task failed'),
    coerceWorkspaceTaskPayload: (value) => coerceAgentServerToolPayload(value),
    schemaErrors: (payload) => {
      const record = isRecord(payload) ? payload : {};
      const missing = ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts']
        .filter((key) => !(key in record))
        .map((key) => `missing ${key}`);
      if ('uiManifest' in record && !Array.isArray(record.uiManifest)) missing.push('uiManifest must be an array');
      if ('claims' in record && !Array.isArray(record.claims)) missing.push('claims must be an array');
      if ('executionUnits' in record && !Array.isArray(record.executionUnits)) missing.push('executionUnits must be an array');
      if ('artifacts' in record && !Array.isArray(record.artifacts)) missing.push('artifacts must be an array');
      return missing;
    },
    firstPayloadFailureReason,
    payloadHasFailureStatus,
  };
}

function round1Task(): AgentServerGenerationResponse {
  return taskResponse('t118-round1.py', [
    'import json, sys',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'request = json.load(open(input_path, encoding="utf-8"))',
    'markdown = "# T118 Round 1 Report\\n\\nThis report was generated through the backend capability path.\\n\\nPrompt: " + request.get("prompt", "")',
    'payload = {',
    '  "message": "Generated T118 round 1 report with markdown.",',
    '  "confidence": 0.88,',
    '  "claimType": "evidence-summary",',
    '  "evidenceLevel": "workspace-task",',
    '  "reasoningTrace": "T118 round 1 generated task read inputPath and wrote outputPath.",',
    '  "claims": [{"text": "Round 1 report markdown was produced.", "supportingRefs": ["artifact:t118-round1-report"]}],',
    '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "t118-round1-report"}],',
    '  "executionUnits": [{"id": "t118-round1", "status": "done", "tool": "agentserver.generated.python"}],',
    '  "artifacts": [{"id": "t118-round1-report", "type": "research-report", "producerScenario": "literature", "schemaVersion": "1", "data": {"markdown": markdown}}]',
    '}',
    'json.dump(payload, open(output_path, "w", encoding="utf-8"), indent=2)',
  ]);
}

function round2Task(): AgentServerGenerationResponse {
  return taskResponse('t118-round2-from-artifact.py', [
    'import json, os, sys',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'request = json.load(open(input_path, encoding="utf-8"))',
    'artifacts = request.get("artifacts", [])',
    'source = next((item for item in artifacts if item.get("id") == "t118-round1-report"), {})',
    'data = source.get("data") if isinstance(source.get("data"), dict) else {}',
    'source_markdown = data.get("markdown", "")',
    'if not source_markdown and source.get("dataRef"):',
    '    ref = source["dataRef"].replace("file:", "").lstrip("/")',
    '    source_markdown = open(os.path.join(request.get("workspacePath", "."), ref), encoding="utf-8").read()',
    'if not source_markdown and isinstance(source.get("dataSummary"), dict):',
    '    preview = source["dataSummary"].get("preview") if isinstance(source["dataSummary"].get("preview"), dict) else {}',
    '    source_markdown = preview.get("markdown", "")',
    'if "backend capability path" not in source_markdown:',
    '    raise RuntimeError("round 2 did not receive the prior report artifact through input.artifacts")',
    'markdown = "\\n\\n".join(["# T118 Round 2 Continuation", "Continued from artifact:t118-round1-report.", source_markdown, "Follow-up: artifact-only continuation succeeded."])',
    'payload = {',
    '  "message": "Continued from artifact:t118-round1-report using backend refs.",',
    '  "confidence": 0.9,',
    '  "claimType": "artifact-continuation",',
    '  "evidenceLevel": "workspace-task",',
    '  "reasoningTrace": "T118 round 2 used only request.artifacts/currentReferences, not UI text guessing.",',
    '  "claims": [{"text": "Round 2 used the prior artifact body.", "supportingRefs": ["artifact:t118-round1-report", "artifact:t118-round2-report"]}],',
    '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "t118-round2-report"}],',
    '  "executionUnits": [{"id": "t118-round2", "status": "done", "tool": "agentserver.generated.python", "params": "artifact:t118-round1-report"}],',
    '  "artifacts": [{"id": "t118-round2-report", "type": "research-report", "producerScenario": "literature", "schemaVersion": "1", "data": {"markdown": markdown}}]',
    '}',
    'json.dump(payload, open(output_path, "w", encoding="utf-8"), indent=2)',
  ]);
}

function repairFromFailedRunTask(): AgentServerGenerationResponse {
  return taskResponse('t118-repair-from-failed-run.py', [
    'import json, sys',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2]',
    'request = json.load(open(input_path, encoding="utf-8"))',
    'expected = "missing " + "--" + "outputPath"',
    'candidates = []',
    'candidates.extend(request.get("recentExecutionRefs", []))',
    'candidates.extend(request.get("priorAttempts", []))',
    'failure = next((item.get("failureReason") for item in candidates if item.get("failureReason")), "")',
    'if failure != expected:',
    '    raise RuntimeError("repair fixture did not receive failed run reason; got %r" % failure)',
    'markdown = "# T118 Failed Run Repair\\n\\nFixed according to failed run reason: " + failure + ".\\n\\nThe recovered task writes its ToolPayload to the SciForge output path argument."',
    'payload = {',
    '  "message": "Repaired according to failed run reason: " + failure + ".",',
    '  "confidence": 0.86,',
    '  "claimType": "repair-summary",',
    '  "evidenceLevel": "workspace-task",',
    '  "reasoningTrace": "T118 repair task consumed recentExecutionRefs/priorAttempts failureReason.",',
    '  "claims": [{"text": "The failed run reason was used to choose the repair.", "supportingRefs": ["run:t118-failed-run", "artifact:t118-repair-report"]}],',
    '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "t118-repair-report"}],',
    '  "executionUnits": [{"id": "t118-repair", "status": "done", "tool": "agentserver.generated.python", "failureReason": failure}],',
    '  "artifacts": [{"id": "t118-repair-report", "type": "research-report", "producerScenario": "literature", "schemaVersion": "1", "data": {"markdown": markdown}}]',
    '}',
    'json.dump(payload, open(output_path, "w", encoding="utf-8"), indent=2)',
  ]);
}

function taskResponse(fileName: string, sourceLines: string[]): AgentServerGenerationResponse {
  const path = `.sciforge/tasks/${fileName}`;
  return {
    taskFiles: [{
      path,
      language: 'python',
      content: sourceLines.join('\n'),
    }],
    entrypoint: { language: 'python', path },
    environmentRequirements: { language: 'python' },
    validationCommand: `python ${path} <input> <output>`,
    expectedArtifacts: ['research-report'],
    patchSummary: `T118 fixture ${fileName}`,
  };
}

function artifactById(payload: ToolPayload, id: string) {
  return payload.artifacts.find((artifact) => artifact.id === id);
}

function markdownFromArtifact(artifact: Record<string, unknown>) {
  const data = isRecord(artifact.data) ? artifact.data : {};
  return typeof data.markdown === 'string' ? data.markdown : '';
}

function metadataString(artifact: Record<string, unknown>, key: string) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return typeof metadata[key] === 'string' ? metadata[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
