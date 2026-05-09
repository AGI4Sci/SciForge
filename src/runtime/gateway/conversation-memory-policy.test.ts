import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationMemoryPlan } from './conversation-memory-policy.js';

test('explicit reference filters stale messages and runs', () => {
  const plan = buildConversationMemoryPlan({
    goalSnapshot: { requiredReferences: ['current.csv'] },
    contextPolicy: { mode: 'isolate' },
    session: {
      messages: [
        { id: 'm-old', role: 'assistant', content: '旧任务结论来自 old.csv', references: ['old.csv'] },
        { id: 'm-current', role: 'user', content: 'current.csv 的新增结果', references: ['current.csv'] },
      ],
      runs: [
        { id: 'r-old', status: 'done', summary: 'old.csv pipeline' },
        { id: 'r-current', status: 'done', summary: 'read current.csv', artifactRefs: ['current.csv'] },
      ],
    },
  });

  assert.deepEqual(plan.recentConversation.map((message) => message.id), ['m-current']);
  assert.deepEqual(plan.recentRuns.map((run) => run.id), ['r-current']);
  assert.deepEqual(
    plan.pollutionGuard.excludedHistory,
    [
      { id: 'm-old', reason: 'not-current-reference-grounded' },
      { id: 'r-old', reason: 'not-current-reference-grounded' },
    ],
  );
});

test('continuation keeps recent conversation and repair keeps failed runs without inline image payloads', () => {
  const continuePlan = buildConversationMemoryPlan({
    contextPolicy: { mode: 'continue' },
    session: { messages: [{ id: 'm1', role: 'assistant', content: '上一轮计划' }] },
  });
  assert.equal(continuePlan.mode, 'continue');
  assert.equal(continuePlan.recentConversation[0].id, 'm1');
  assert.deepEqual(continuePlan.pollutionGuard.excludedHistory, []);

  const repairPlan = buildConversationMemoryPlan({
    contextPolicy: { mode: 'repair' },
    session: {
      runs: [
        { id: 'r-ok', status: 'done', summary: 'completed' },
        { id: 'r-fail', status: 'failed', error: 'bad screenshot data:image/png;base64,AAA' },
      ],
    },
  });
  assert.deepEqual(repairPlan.recentRuns.map((run) => run.id), ['r-fail']);
  assert.doesNotMatch(String(repairPlan.recentRuns[0].summary), /data:image/);
  assert.doesNotMatch(String(repairPlan.recentRuns[0].summary), /;base64,/);
});
