import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptAndRepairAgentResponse, buildUserGoalSnapshot, extractObjectReferencesFromText } from './turnAcceptance';
import type { BioAgentSession, NormalizedAgentResponse } from './domain';

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
