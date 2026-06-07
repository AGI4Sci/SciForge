import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DIRECT_CONTEXT_FAST_PATH_POLICY } from '@sciforge-ui/runtime-contract/artifact-policy';
import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const readyWebSearchProvider = { id: 'sciforge.web-worker.web_search', available: true, status: 'ready' };

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-ref-followup-'));
await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });

await appendTaskAttempt(workspace, {
  id: 'generated-literature-smoke',
  prompt: 'Round 1: search recent AI agent papers and write a report',
  skillDomain: 'literature',
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-smoke',
  attempt: 1,
  status: 'done',
  codeRef: '.sciforge/tasks/generated-literature-smoke/run.py',
  inputRef: '.sciforge/task-inputs/generated-literature-smoke.json',
  outputRef: '.sciforge/task-results/generated-literature-smoke.json',
  stdoutRef: '.sciforge/logs/generated-literature-smoke.stdout.log',
  stderrRef: '.sciforge/logs/generated-literature-smoke.stderr.log',
  exitCode: 0,
  createdAt: new Date().toISOString(),
});

await writeFile(join(workspace, '.sciforge', 'artifacts', 'session-smoke-paper-list.json'), JSON.stringify({
  id: 'paper-list',
  type: 'paper-list',
  data: {
    rows: [
      { title: 'AgentPulse: A Continuous Multi-Signal Framework for Evaluating AI Agents in Deployment' },
      { title: 'On the Footprints of Reviewer Bots Feedback on Agentic Pull Requests in OSS GitHub Repositories' },
      { title: 'GAMMAF: Graph-Based Anomaly Monitoring Benchmarking in LLM Multi-Agent Systems' },
      { title: 'AgenticCache: Cache-Driven Asynchronous Planning for Embodied AI Agents' },
      { title: 'QED: An Open-Source Multi-Agent System for Generating Mathematical Proofs' },
    ],
  },
}, null, 2));

await writeFile(join(workspace, '.sciforge', 'artifacts', 'session-smoke-research-report.json'), JSON.stringify({
  id: 'research-report',
  type: 'research-report',
  data: { markdown: '## Summary\nAI agent papers cover deployment monitoring, software engineering, multi-agent anomaly detection, planning caches, and math proof systems.' },
}, null, 2));

const selectedReportRef = '.sciforge/artifacts/selected-old-research-report.md';
await writeFile(join(workspace, selectedReportRef), [
  '# Selected research report',
  '',
  '| Title | Year | Venue | URL | fullTextStatus | evidenceLocation | Summary | Limitations |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| ShopGym | 2026 | arXiv | https://arxiv.org/abs/2601.00001 | PDF/full-text extracted | https://arxiv.org/pdf/2601.00001#page=2 | GUI browser agents benchmark for shopping workflows. | Needs more replication. |',
  '| ScreenSearch | 2026 | arXiv | https://arxiv.org/abs/2601.00002 | PDF/full-text extracted | https://arxiv.org/pdf/2601.00002#page=3 | Screen-grounded search for computer-use agents. | Synthetic tasks. |',
  '| PAGER | 2026 | arXiv | https://arxiv.org/abs/2601.00003 | PDF/full-text metadata only | https://arxiv.org/abs/2601.00003 | Page exploration and retrieval for web agents. | Full text not verified. |',
].join('\n'));

let requestBody = '';
let generationDispatchCount = 0;
const generatedReportTask = String.raw`
import json
import sys

output_path = sys.argv[2]
payload = {
  "message": "Completed the requested per-paper summary report from prior context.",
  "confidence": 0.82,
  "claimType": "evidence-summary",
  "evidenceLevel": "workspace-task",
  "reasoningTrace": "backend generation run completed a continuation report task.",
  "claims": [{"text": "The continuation report was generated from prior paper-list context.", "confidence": 0.82, "evidenceLevel": "workspace-task"}],
  "uiManifest": [
    {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 1},
    {"componentId": "paper-card-list", "artifactRef": "paper-list", "priority": 2},
    {"componentId": "execution-unit-table", "artifactRef": "research-report", "priority": 3}
  ],
  "executionUnits": [{
    "id": "literature-continuation-report",
    "status": "done",
    "tool": "generated-task.generate..python",
    "params": "{}"
  }],
  "artifacts": [{
    "id": "paper-list",
    "type": "paper-list",
    "producerScenario": "literature",
    "schemaVersion": "1",
    "data": {"rows": [
      {"title": "AgentPulse", "summary": "deployment monitoring", "innovation": "continuous multi-signal evaluation", "method": "benchmark instrumentation"},
      {"title": "Reviewer Bots", "summary": "agentic PR feedback", "innovation": "OSS footprint analysis", "method": "repository mining"}
    ]}
  }, {
    "id": "research-report",
    "type": "research-report",
    "producerScenario": "literature",
    "schemaVersion": "1",
    "data": {"markdown": "## Per-paper report\n\n- AgentPulse: summary, innovation, method.\n- Reviewer Bots: summary, innovation, method."}
  }]
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;
const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs/stream') {
    res.writeHead(404);
    res.end();
    return;
  }
  requestBody = await new Promise<string>((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
  res.setHeader('Content-Type', 'application/jsonl');
  res.end(JSON.stringify({
    result: {
      ok: true,
      data: {
        run: {
          id: 'mock-report-continuation-generation',
          output: {
            result: {
              taskFiles: [{ path: '.sciforge/tasks/literature-continuation-report.py', language: 'python', content: generatedReportTask }],
              entrypoint: { language: 'python', path: '.sciforge/tasks/literature-continuation-report.py' },
              environmentRequirements: { language: 'python' },
              validationCommand: 'python .sciforge/tasks/literature-continuation-report.py <input> <output>',
              expectedArtifacts: ['paper-list', 'research-report'],
              patchSummary: 'Generated a continuation report task from prior context.',
            },
          },
        },
      },
    },
  }) + '\n');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const mockBaseUrl = `http://127.0.0.1:${address.port}`;

let contextDispatchCount = 0;
let directContextDispatchCount = 0;
const selectedReference = {
  ref: 'artifact:research-report',
  title: 'selected research-report',
  dataRef: selectedReportRef,
  path: selectedReportRef,
  kind: 'artifact',
  artifactType: 'research-report',
};
const unselectedLatestReport = {
  id: 'research-report',
  type: 'research-report',
  data: {
    markdown: 'LATEST-NOT-SELECTED AlphaBeta contamination should never appear.',
  },
  metadata: { source: 'latest-unselected-run' },
};
const selectedReportFollowup = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: '只基于选中的 research-report，不启动新搜索。请按优先级列出 3 篇论文的要点、证据和局限。',
  workspacePath: workspace,
  agentServerBaseUrl: mockBaseUrl,
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-smoke',
  expectedArtifactTypes: ['research-report'],
  references: [selectedReference],
  uiState: {
    capabilityProviderAvailability: [readyWebSearchProvider],
    contextReusePolicy: { selectedRefsOnly: true },
    currentReferences: [selectedReference],
  },
  artifacts: [
    { id: 'research-report', type: 'research-report', dataRef: selectedReportRef },
    unselectedLatestReport,
  ],
}, {
  onEvent(event) {
    if (event.type === 'agentserver-context-answer-dispatch') contextDispatchCount += 1;
    if (event.type === 'agentserver-dispatch') generationDispatchCount += 1;
    if (event.type === 'direct-context-fast-path') directContextDispatchCount += 1;
  },
});

assert.equal(contextDispatchCount, 0);
assert.equal(generationDispatchCount, 0);
assert.equal(directContextDispatchCount, 1);
assert.equal(requestBody, '');
assert.equal(selectedReportFollowup.executionUnits[0]?.tool, DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId);
assert.match(selectedReportFollowup.reasoningTrace, /direct-context fast path/i);
assert.match(selectedReportFollowup.message, /ShopGym/);
assert.match(selectedReportFollowup.message, /ScreenSearch/);
assert.match(selectedReportFollowup.message, /PAGER/);
assert.match(selectedReportFollowup.message, /不启动新的 workspace task|不重新检索/);
assert.doesNotMatch(selectedReportFollowup.message, /LATEST-NOT-SELECTED|AlphaBeta/);
assert.ok(selectedReportFollowup.objectReferences?.some((ref) => ref.ref === selectedReportRef));
const selectedContextReport = selectedReportFollowup.artifacts.find((artifact) => artifact.type === DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactType);
assert.ok(selectedContextReport);
const directContextRows = isRecord(selectedContextReport.data) && Array.isArray(selectedContextReport.data.context)
  ? selectedContextReport.data.context.filter(isRecord)
  : [];
assert.ok(directContextRows.length >= 1);
assert.ok(directContextRows.every((row) => String(row.ref || '').includes(selectedReportRef)));
assert.doesNotMatch(JSON.stringify(directContextRows), /LATEST-NOT-SELECTED|AlphaBeta/);

const reportContinuation = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: '你怎么没有按照要求写一份总结报告，每篇论文需要有简要总结、创新点、方法介绍，并更新 research-report artifact/ref。请基于上一轮结果继续完成，不要重新检索。',
  workspacePath: workspace,
  agentServerBaseUrl: mockBaseUrl,
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-smoke',
  expectedArtifactTypes: ['paper-list', 'research-report'],
  uiState: {
    capabilityProviderAvailability: [readyWebSearchProvider],
    recentConversation: [
      'user: Round 1 search recent AI agent papers',
      'assistant: Completed and produced paper-list and research-report artifacts.',
      'user: 你怎么没有按照要求写总结报告',
    ],
    recentExecutionRefs: [{
      id: 'generated-literature-task',
      status: 'done',
      codeRef: '.sciforge/tasks/generated-literature-smoke/run.py',
      outputRef: '.sciforge/task-results/generated-literature-smoke.json',
      stdoutRef: '.sciforge/logs/generated-literature-smoke.stdout.log',
      stderrRef: '.sciforge/logs/generated-literature-smoke.stderr.log',
    }],
  },
  artifacts: selectedReportFollowup.artifacts,
}, {
  onEvent(event) {
    if (event.type === 'agentserver-context-answer-dispatch') contextDispatchCount += 1;
    if (event.type === 'agentserver-dispatch') generationDispatchCount += 1;
    if (event.type === 'direct-context-fast-path') directContextDispatchCount += 1;
  },
});
assert.equal(contextDispatchCount, 0);
assert.equal(generationDispatchCount, 1);
assert.equal(directContextDispatchCount, 1);
assert.match(requestBody, /workspace-task-generation/);
assert.match(requestBody, /contextEnvelope/);
assert.notEqual(reportContinuation.executionUnits[0]?.tool, DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId);
assert.match(reportContinuation.reasoningTrace, /backend generation run|continuation report task/i);
assert.ok(reportContinuation.artifacts.some((artifact) => artifact.type === 'paper-list'));
assert.ok(reportContinuation.artifacts.some((artifact) => artifact.type === 'research-report'));

await new Promise<void>((resolve) => server.close(() => resolve()));

const failedWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-ref-failed-'));
await mkdir(join(failedWorkspace, '.sciforge', 'artifacts'), { recursive: true });
await appendTaskAttempt(failedWorkspace, {
  id: 'generated-literature-success-old',
  prompt: 'older successful search',
  skillDomain: 'literature',
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-failed-smoke',
  attempt: 1,
  status: 'done',
  codeRef: '.sciforge/tasks/old-success.py',
  outputRef: '.sciforge/task-results/old-success.json',
  stdoutRef: '.sciforge/logs/old-success.stdout.log',
  stderrRef: '.sciforge/logs/old-success.stderr.log',
  exitCode: 0,
  createdAt: '2026-04-28T00:00:00.000Z',
});
await appendTaskAttempt(failedWorkspace, {
  id: 'referenced-literature-latest-failure',
  prompt: 'latest follow-up tried to run current task',
  skillDomain: 'literature',
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-failed-smoke',
  attempt: 1,
  status: 'failed-with-reason',
  codeRef: '.sciforge/tasks/current-failed.py',
  inputRef: '.sciforge/task-inputs/current-failed.json',
  outputRef: '.sciforge/task-results/current-failed.json',
  stdoutRef: '.sciforge/logs/current-failed.stdout.log',
  stderrRef: '.sciforge/logs/current-failed.stderr.log',
  exitCode: 2,
  failureReason: 'missing --outputPath',
  createdAt: '2026-04-28T01:00:00.000Z',
});
await writeFile(join(failedWorkspace, '.sciforge', 'artifacts', 'session-other-paper-list.json'), JSON.stringify({
  id: 'paper-list',
  type: 'paper-list',
  data: { rows: [{ title: 'Unrelated old paper' }] },
}, null, 2));

const failedAnswer = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: '我在哪可以找到下载的论文，以及总结报告',
  workspacePath: failedWorkspace,
  agentServerBaseUrl: 'http://127.0.0.1:1',
  scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  skillPlanRef: 'skill-plan-failed-smoke',
  uiState: {
    sessionId: 'session-current-failed',
    recentConversation: [
      'user: 帮我检索今天 arxiv multi agent 论文',
      'assistant: Task failed because --outputPath was missing.',
      'user: 我在哪可以找到下载的论文，以及总结报告',
    ],
    recentExecutionRefs: [{
      id: 'current-failed',
      status: 'failed-with-reason',
      codeRef: '.sciforge/tasks/current-failed.py',
      outputRef: '.sciforge/task-results/current-failed.json',
      stdoutRef: '.sciforge/logs/current-failed.stdout.log',
      stderrRef: '.sciforge/logs/current-failed.stderr.log',
      failureReason: 'missing --outputPath',
    }],
  },
  artifacts: [],
});
assert.match(failedAnswer.message, /Capability provider route preflight|backend generation request failed|Agent backend context answer failed|Agent backend is required|repair/i);
assert.doesNotMatch(failedAnswer.message, /old-success\.py|Unrelated old paper/);

console.log('[ok] artifact reference follow-up uses selected durable refs and direct-context without legacy backend dispatch');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
