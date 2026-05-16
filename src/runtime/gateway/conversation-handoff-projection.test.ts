import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationHandoffMemoryProjection } from './conversation-handoff-projection.js';

test('explicit reference filters stale messages and runs', () => {
  const plan = buildConversationHandoffMemoryProjection({
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

  assert.deepEqual(plan.selectedMessageRefs.map((message) => message.id), ['m-current']);
  assert.deepEqual(plan.selectedRunRefs.map((run) => run.id), ['r-current']);
  assert.equal(plan.authority, 'workspace-project-session-memory');
  assert.equal(plan.projectSessionMemory.schemaVersion, 'sciforge.project-session-ledger-projection.v1');
  assert.ok(plan.contextProjectionBlocks.some((block) => block.kind === 'index'));
  assert.ok(plan.contextRefs.some((ref) => String(ref).startsWith('ledger-event:')));
  assert.deepEqual(
    plan.pollutionGuard.excludedHistory,
    [
      { id: 'm-old', reason: 'not-current-reference-grounded' },
      { id: 'r-old', reason: 'not-current-reference-grounded' },
    ],
  );
});

test('continuation keeps recent conversation and repair keeps failed runs without inline image payloads', () => {
  const continuePlan = buildConversationHandoffMemoryProjection({
    contextPolicy: { mode: 'continue' },
    session: { messages: [{ id: 'm1', role: 'assistant', content: '上一轮计划' }] },
  });
  assert.equal(continuePlan.mode, 'continue');
  assert.equal(continuePlan.selectedMessageRefs[0].id, 'm1');
  assert.ok(continuePlan.stablePrefixHash.startsWith('sha256:'));
  assert.deepEqual(continuePlan.pollutionGuard.excludedHistory, []);
  assert.equal('recentConversation' in continuePlan, false);
  assert.equal('recentRuns' in continuePlan, false);

  const repairPlan = buildConversationHandoffMemoryProjection({
    contextPolicy: { mode: 'repair' },
    session: {
      runs: [
        { id: 'r-ok', status: 'done', summary: 'completed' },
        { id: 'r-fail', status: 'failed', error: 'bad screenshot data:image/png;base64,AAA' },
      ],
    },
  });
  assert.deepEqual(repairPlan.selectedRunRefs.map((run) => run.id), ['r-fail']);
  assert.ok(Array.isArray(repairPlan.projectSessionMemory.failureIndex));
  assert.ok(repairPlan.projectSessionMemory.failureIndex.length >= 1);
  assert.doesNotMatch(String(repairPlan.selectedRunRefs[0].summary), /data:image/);
  assert.doesNotMatch(String(repairPlan.selectedRunRefs[0].summary), /;base64,/);
  assert.doesNotMatch(JSON.stringify(repairPlan), /recentConversation|recentRuns|rawHistory|fullRefList|compactionState/);
});
