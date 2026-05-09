import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyExecutionMode } from './conversation-execution-classifier.js';

test('direct context explanation does not require workspace execution', () => {
  const decision = classifyExecutionMode({
    prompt: '解释这个已有结果表的置信区间是什么意思。',
    artifacts: [{ artifactType: 'table', status: 'done', summary: 'model metrics' }],
  });

  assert.equal(decision.executionMode, 'direct-context-answer');
  assert.equal(decision.reproducibilityLevel, 'none');
  assert.deepEqual(decision.stagePlanHint, []);
  assert.ok(decision.complexityScore < 0.25);
});

test('runtime planning skill does not force selected action signal', () => {
  const decision = classifyExecutionMode({
    prompt: '解释这个已有结果表的置信区间是什么意思。',
    artifacts: [{ artifactType: 'table', status: 'done', summary: 'model metrics' }],
    selectedCapabilities: [{
      id: 'scenario.literature.agentserver-generation',
      kind: 'skill',
      adapter: 'agentserver:generation',
      summary: 'Runtime planning skill for literature tasks.',
    }],
  });

  assert.equal(decision.executionMode, 'direct-context-answer');
  assert.ok(!decision.signals.includes('selected-action'));
  assert.ok(!decision.signals.includes('external-action'));
});

test('current search routes to thin reproducible adapter', () => {
  const decision = classifyExecutionMode({
    prompt: '查一下今天这个工具的最新发布状态，简单总结。',
    selectedTools: [{ id: 'web.search', summary: 'Search current web pages.' }],
  });

  assert.equal(decision.executionMode, 'thin-reproducible-adapter');
  assert.equal(decision.reproducibilityLevel, 'light');
  assert.deepEqual(decision.stagePlanHint, ['search', 'fetch', 'emit']);
  assert.ok(decision.riskFlags.includes('external-information-required'));
});

test('repair signals route to continue project', () => {
  const decision = classifyExecutionMode({
    prompt: '根据日志修复上一轮失败。',
    recentFailures: [{ stageId: '2-fetch', failureReason: 'timeout' }],
  });

  assert.equal(decision.executionMode, 'repair-or-continue-project');
  assert.ok(decision.signals.includes('repair'));
  assert.ok(decision.riskFlags.includes('recent-failure'));
});
