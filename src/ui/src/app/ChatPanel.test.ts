import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runIdForMessage } from './ChatPanel';
import type { SciForgeMessage, SciForgeRun } from '../domain';

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
