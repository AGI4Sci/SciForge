import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROCESS_PROGRESS_EVENT_TYPE, PROCESS_PROGRESS_PHASE, PROCESS_PROGRESS_STATUS } from '@sciforge-ui/runtime-contract';
import { runIdForMessage, runningMessageContentFromStream } from './ChatPanel';
import type { AgentStreamEvent, SciForgeMessage, SciForgeRun } from '../domain';

const messages: SciForgeMessage[] = [
  { id: 'system-upload', role: 'system', content: '已上传 1 个文件', createdAt: '2026-05-07T00:00:00.000Z' },
  { id: 'user-current', role: 'user', content: '阅读理解这篇论文，写一份总结报告', createdAt: '2026-05-07T00:01:00.000Z' },
  { id: 'scenario-answer', role: 'scenario', content: '已生成总结报告', createdAt: '2026-05-07T00:02:00.000Z' },
];

const runs: SciForgeRun[] = [{
  id: 'run-current',
  scenarioId: 'literature-evidence-review',
  status: 'completed',
  prompt: '阅读理解这篇论文，写一份总结报告',
  response: '已生成总结报告',
  createdAt: '2026-05-07T00:02:00.000Z',
}];

test('run key info attaches to scenario answer, not system upload message', () => {
  assert.equal(runIdForMessage(messages[0], 0, messages, runs), undefined);
  assert.equal(runIdForMessage(messages[1], 1, messages, runs), 'run-current');
  assert.equal(runIdForMessage(messages[2], 2, messages, runs), 'run-current');
});

test('run key info follows repeated follow-up turns without prompt pollution', () => {
  const followupMessages: SciForgeMessage[] = [
    { id: 'user-1', role: 'user', content: '继续', createdAt: '2026-05-07T00:01:00.000Z' },
    { id: 'scenario-1', role: 'scenario', content: '第一轮继续完成', createdAt: '2026-05-07T00:02:00.000Z' },
    { id: 'user-2', role: 'user', content: '运行中引导：继续', createdAt: '2026-05-07T00:03:00.000Z' },
    { id: 'scenario-2', role: 'scenario', content: '第二轮继续完成', createdAt: '2026-05-07T00:04:00.000Z' },
  ];
  const followupRuns: SciForgeRun[] = [{
    id: 'run-followup-1',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: '继续',
    response: '第一轮继续完成',
    createdAt: '2026-05-07T00:02:00.000Z',
  }, {
    id: 'run-followup-2',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: '继续',
    response: '第二轮继续完成',
    createdAt: '2026-05-07T00:04:00.000Z',
  }];

  assert.equal(runIdForMessage(followupMessages[0], 0, followupMessages, followupRuns), 'run-followup-1');
  assert.equal(runIdForMessage(followupMessages[1], 1, followupMessages, followupRuns), 'run-followup-1');
  assert.equal(runIdForMessage(followupMessages[2], 2, followupMessages, followupRuns), 'run-followup-2');
  assert.equal(runIdForMessage(followupMessages[3], 3, followupMessages, followupRuns), 'run-followup-2');
});

test('running message follows structured progress fields instead of prompt or scenario semantics', () => {
  const events: AgentStreamEvent[] = [{
    id: 'evt-structured-progress',
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: '过程',
    detail: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
    createdAt: '2026-05-08T00:00:00.000Z',
    raw: {
      prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE search write failed approval',
      scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE retrieval repair blocked',
      progress: {
        phase: PROCESS_PROGRESS_PHASE.WAIT,
        title: '结构化等待状态',
        detail: 'structured progress detail wins',
        reading: ['/structured/read.csv'],
        waitingFor: 'structured backend event',
        nextStep: 'structured next step',
        status: PROCESS_PROGRESS_STATUS.RUNNING,
      },
    },
  }];

  const content = runningMessageContentFromStream('', events);

  assert.match(content, /结构化等待状态/);
  assert.match(content, /读 \/structured\/read\.csv/);
  assert.match(content, /等 structured backend event/);
  assert.match(content, /下一步 structured next step/);
  assert.doesNotMatch(content, /PROMPT_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(content, /SCENARIO_TEXT_SHOULD_NOT_DECIDE/);
  assert.doesNotMatch(content, /search write failed approval/);
  assert.doesNotMatch(content, /retrieval repair blocked/);
});
