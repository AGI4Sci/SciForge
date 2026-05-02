import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptAndRepairAgentResponse, buildBackendAcceptanceRepairPrompt, buildUserGoalSnapshot, extractObjectReferencesFromText, shouldRunBackendAcceptanceRepair } from './turnAcceptance';
import type { BioAgentSession, NormalizedAgentResponse, SemanticTurnAcceptance, TurnAcceptance } from './domain';

const baseSession: BioAgentSession = {
  schemaVersion: 2,
  sessionId: 'session-test',
  scenarioId: 'literature-evidence-review',
  title: 'test',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
};

function responseWithContent(content: string): NormalizedAgentResponse {
  return {
    message: {
      id: 'msg-agent',
      role: 'scenario',
      content,
      createdAt: '2026-05-01T00:00:00.000Z',
      status: 'completed',
    },
    run: {
      id: 'run-test',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'test',
      response: content,
      createdAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  };
}

const semanticPass: SemanticTurnAcceptance = {
  pass: true,
  confidence: 0.91,
  unmetCriteria: [],
  missingArtifacts: [],
  referencedEvidence: ['final-answer'],
  backendRunRef: 'run:semantic-pass',
};

const semanticFail: SemanticTurnAcceptance = {
  pass: false,
  confidence: 0.72,
  unmetCriteria: ['answer does not compare the requested papers'],
  missingArtifacts: ['evidence-matrix'],
  referencedEvidence: ['final-answer'],
  repairPrompt: 'Compare the requested papers and add an evidence matrix artifact.',
  backendRunRef: 'run:semantic-fail',
};

test('extractObjectReferencesFromText turns final reply paths into clickable file refs', () => {
  const refs = extractObjectReferencesFromText(
    '报告已经生成在 `.bioagent/tasks/run-1/report/arxiv-agent-reading-report.md`，表格在 file:.bioagent/tasks/run-1/results.csv。',
    baseSession,
  );

  assert.equal(refs.length, 2);
  assert.equal(refs[0].kind, 'file');
  assert.equal(refs[0].ref, 'file:.bioagent/tasks/run-1/report/arxiv-agent-reading-report.md');
  assert.equal(refs[0].preferredView, 'report-viewer');
  assert.equal(refs[1].ref, 'file:.bioagent/tasks/run-1/results.csv');
});

test('acceptAndRepairAgentResponse records goal acceptance and object refs for report paths', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-test',
    prompt: '请生成 markdown 阅读报告',
    scenarioId: 'literature-evidence-review',
    expectedArtifacts: ['research-report'],
  });
  const response: NormalizedAgentResponse = {
    message: {
      id: 'msg-agent',
      role: 'scenario',
      content: 'Markdown 报告路径：.bioagent/tasks/run-1/report.md',
      createdAt: '2026-05-01T00:00:00.000Z',
      status: 'completed',
    },
    run: {
      id: 'run-test',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: snapshot.rawPrompt,
      response: 'Markdown 报告路径：.bioagent/tasks/run-1/report.md',
      createdAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  };

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });

  assert.equal(accepted.message.objectReferences?.[0].ref, 'file:.bioagent/tasks/run-1/report.md');
  assert.equal(accepted.message.acceptance?.pass, true);
  assert.equal(accepted.run.goalSnapshot?.goalType, 'report');
  assert.equal(accepted.run.raw && typeof accepted.run.raw === 'object' && 'turnAcceptance' in accepted.run.raw, true);
});

test('acceptAndRepairAgentResponse flags raw ToolPayload leakage as repairable', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-json',
    prompt: '请生成 markdown 阅读报告',
    scenarioId: 'literature-evidence-review',
  });
  const response: NormalizedAgentResponse = {
    message: {
      id: 'msg-agent',
      role: 'scenario',
      content: '```json\n{"message":"报告已完成","uiManifest":[],"artifacts":[]}\n```',
      createdAt: '2026-05-01T00:00:00.000Z',
      status: 'completed',
    },
    run: {
      id: 'run-json',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: snapshot.rawPrompt,
      response: '```json\n{"message":"报告已完成","uiManifest":[],"artifacts":[]}\n```',
      createdAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  };

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });

  assert.equal(accepted.message.content, '报告已完成');
  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'raw-payload-leak'), true);
});

test('deterministic pass plus semantic pass accepts the turn', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-semantic-pass',
    prompt: '请生成 markdown 阅读报告',
    scenarioId: 'literature-evidence-review',
  });
  const accepted = acceptAndRepairAgentResponse({
    snapshot,
    response: responseWithContent('Markdown 报告路径：.bioagent/tasks/run-1/report.md'),
    session: baseSession,
    semanticAcceptance: semanticPass,
  });

  assert.equal(accepted.message.acceptance?.pass, true);
  assert.equal(accepted.message.acceptance?.severity, 'pass');
  assert.equal(accepted.message.acceptance?.semantic?.backendRunRef, 'run:semantic-pass');
});

test('deterministic failure vetoes semantic pass', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-deterministic-veto',
    prompt: '请生成 markdown 阅读报告',
    scenarioId: 'literature-evidence-review',
  });
  const accepted = acceptAndRepairAgentResponse({
    snapshot,
    response: responseWithContent('任务完成。'),
    session: baseSession,
    semanticAcceptance: semanticPass,
  });

  assert.equal(accepted.message.acceptance?.pass, false);
  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'missing-readable-report'), true);
  assert.equal(accepted.message.acceptance?.semantic?.pass, true);
});

test('deterministic pass plus semantic failure records repair prompt', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-semantic-fail',
    prompt: '请生成 markdown 阅读报告并给出 evidence matrix',
    scenarioId: 'literature-evidence-review',
  });
  const accepted = acceptAndRepairAgentResponse({
    snapshot,
    response: responseWithContent('Markdown 报告路径：.bioagent/tasks/run-1/report.md'),
    session: baseSession,
    semanticAcceptance: semanticFail,
  });

  assert.equal(accepted.message.acceptance?.pass, false);
  assert.equal(accepted.message.acceptance?.severity, 'repairable');
  assert.equal(accepted.message.acceptance?.repairPrompt, semanticFail.repairPrompt);
  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'semantic-missing-artifacts'), true);
});

test('AgentServer semantic validation unavailable falls back to deterministic-only acceptance', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-semantic-unavailable',
    prompt: '请生成 markdown 阅读报告',
    scenarioId: 'literature-evidence-review',
  });
  const accepted = acceptAndRepairAgentResponse({
    snapshot,
    response: responseWithContent('Markdown 报告路径：.bioagent/tasks/run-1/report.md'),
    session: baseSession,
  });

  assert.equal(accepted.message.acceptance?.pass, true);
  assert.equal(accepted.message.acceptance?.semantic, undefined);
});

test('missing markdown report triggers one backend artifact repair prompt with current refs', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-missing-md',
    prompt: '请生成 markdown 阅读报告，并返回 .md 文件',
    scenarioId: 'literature-evidence-review',
    expectedArtifacts: ['research-report'],
  });
  const response = responseFixture({
    runId: 'run-missing-md',
    content: '报告已完成。',
    artifacts: [],
    executionUnits: [{ id: 'EU-report', tool: 'agentserver.generated.python', params: '{}', status: 'done', hash: 'ok' }],
  });

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });
  const acceptance = accepted.message.acceptance!;
  const prompt = buildBackendAcceptanceRepairPrompt({ snapshot, acceptance, response: accepted, session: baseSession });

  assert.equal(acceptance.pass, false);
  assert.equal(acceptance.failures.some((failure) => failure.code === 'missing-readable-report' && failure.repairAction === 'artifact-repair'), true);
  assert.equal(shouldRunBackendAcceptanceRepair(acceptance), true);
  assert.match(prompt, /UserGoalSnapshot/);
  assert.match(prompt, /deterministic/);
  assert.match(prompt, /currentArtifacts/);
  assert.match(prompt, /objectReferences/);
  assert.match(prompt, /runReferences/);
  assert.match(prompt, /executionReferences/);
  assert.match(prompt, /expectedOutputFormat/);
  assert.match(prompt, /\.md file\/ref/);
});

test('execution failure repair prompt carries stderr and code refs', () => {
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-exec-failed',
    prompt: '运行任务并生成 markdown 报告',
    scenarioId: 'literature-evidence-review',
    expectedArtifacts: ['research-report'],
  });
  const response = responseFixture({
    runId: 'run-exec-failed',
    status: 'failed',
    content: '任务执行失败。',
    executionUnits: [{
      id: 'EU-download',
      tool: 'agentserver.generated.python',
      params: '{}',
      status: 'failed-with-reason',
      hash: 'bad',
      failureReason: 'Download API returned 500',
      stderrRef: '.bioagent/logs/EU-download.stderr.log',
      stdoutRef: '.bioagent/logs/EU-download.stdout.log',
      codeRef: '.bioagent/tasks/download.py',
    }],
  });

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });
  const prompt = buildBackendAcceptanceRepairPrompt({ snapshot, acceptance: accepted.message.acceptance!, response: accepted, session: baseSession });

  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'execution-failed' && failure.repairAction === 'execution-repair'), true);
  assert.equal(shouldRunBackendAcceptanceRepair(accepted.message.acceptance), true);
  assert.match(prompt, /Download API returned 500/);
  assert.match(prompt, /\.bioagent\/logs\/EU-download.stderr.log/);
  assert.match(prompt, /\.bioagent\/tasks\/download.py/);
});

test('backend repair budget exhaustion prevents another rerun', () => {
  const acceptance: TurnAcceptance = {
    pass: false,
    severity: 'failed',
    checkedAt: '2026-05-01T00:00:00.000Z',
    failures: [{ code: 'execution-failed', detail: 'failed once', repairAction: 'execution-repair' }],
    objectReferences: [],
    repairHistory: [{
      attempt: 1,
      action: 'execution-repair',
      status: 'failed-with-reason',
      startedAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:00:01.000Z',
      sourceRunId: 'run-1',
      repairRunId: 'run-2',
      failureCodes: ['execution-failed'],
      reason: 'still failed',
    }],
  };

  assert.equal(shouldRunBackendAcceptanceRepair(acceptance), false);
});

test('explicit references must be reflected in the final answer or artifacts', () => {
  const reference = {
    id: 'ref-text-limitation',
    kind: 'ui' as const,
    title: '选中文本 · low sample size',
    ref: 'ui-text:message:msg-limitation#abc',
    sourceId: 'msg-limitation',
    summary: 'low sample size weakens the claim',
    payload: {
      composerMarker: '※1',
      selectedText: 'low sample size weakens the claim',
      sourceRef: 'message:msg-limitation',
    },
  };
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-reference-unused',
    prompt: '※1 这个限制会不会推翻结论？',
    scenarioId: 'literature-evidence-review',
    references: [reference],
  });
  const response = responseWithContent('结论仍然成立。');
  response.message.references = [reference];
  response.run.references = [reference];

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });

  assert.equal(accepted.message.acceptance?.pass, false);
  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'unused-explicit-references'), true);
  assert.equal(shouldRunBackendAcceptanceRepair(accepted.message.acceptance), true);
});

test('explicit references pass when selected evidence changes the answer', () => {
  const reference = {
    id: 'ref-text-limitation',
    kind: 'ui' as const,
    title: '选中文本 · low sample size',
    ref: 'ui-text:message:msg-limitation#abc',
    sourceId: 'msg-limitation',
    summary: 'low sample size weakens the claim',
    payload: {
      composerMarker: '※1',
      selectedText: 'low sample size weakens the claim',
      sourceRef: 'message:msg-limitation',
    },
  };
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-reference-used',
    prompt: '※1 这个限制会不会推翻结论？',
    scenarioId: 'literature-evidence-review',
    references: [reference],
  });
  const response = responseWithContent('※1 提到的 low sample size weakens the claim，因此我会把结论降级为暂定支持。');
  response.message.references = [reference];
  response.run.references = [reference];

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });

  assert.equal(accepted.message.acceptance?.pass, true);
});

test('generic UI element references are preserved without forcing selector text into the answer', () => {
  const reference = {
    id: 'ref-ui-explorer-node',
    kind: 'ui' as const,
    title: 'pdf-extract',
    ref: 'ui:div.explorer-node:nth-of-type(2) > div.explorer-row > span.explorer-label',
    summary: 'pdf-extract',
    payload: {
      tagName: 'span',
      className: 'explorer-label',
      textPreview: 'pdf-extract',
    },
  };
  const snapshot = buildUserGoalSnapshot({
    turnId: 'turn-generic-ui-reference',
    prompt: '※1 帮我基于这个元素继续分析',
    scenarioId: 'literature-evidence-review',
    references: [reference],
  });
  const response = responseWithContent('我会把这个 UI 元素作为当前操作上下文，并继续分析相关结果。');
  response.message.references = [reference];
  response.run.references = [reference];

  const accepted = acceptAndRepairAgentResponse({ snapshot, response, session: baseSession });

  assert.equal(accepted.message.acceptance?.failures.some((failure) => failure.code === 'unused-explicit-references'), false);
});

function responseFixture({
  runId,
  content,
  status = 'completed',
  artifacts = [],
  executionUnits = [],
}: {
  runId: string;
  content: string;
  status?: NormalizedAgentResponse['run']['status'];
  artifacts?: NormalizedAgentResponse['artifacts'];
  executionUnits?: NormalizedAgentResponse['executionUnits'];
}): NormalizedAgentResponse {
  return {
    message: {
      id: `msg-${runId}`,
      role: 'scenario',
      content,
      createdAt: '2026-05-01T00:00:00.000Z',
      status,
    },
    run: {
      id: runId,
      scenarioId: 'literature-evidence-review',
      status,
      prompt: 'fixture prompt',
      response: content,
      createdAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:00:00.000Z',
    },
    uiManifest: [],
    claims: [],
    executionUnits,
    artifacts,
    notebook: [],
  };
}
