import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationContextPolicy, shouldIsolateHistory } from './conversation-context-policy.js';

test('new task isolates prior session history even with explicit current refs', () => {
  const policy = buildConversationContextPolicy({
    prompt: '新任务：分析 current.json。',
    goalSnapshot: {
      rawPrompt: '新任务：分析 current.json。',
      requiredReferences: ['current.json'],
    },
    session: {
      messages: [
        { id: 'old', goalSnapshot: { rawPrompt: '旧任务：Tabula Sapiens atlas' } },
      ],
    },
  });

  assert.equal(policy.mode, 'isolate');
  assert.equal(policy.historyReuse.allowed, false);
  assert.equal(policy.pollutionGuard.dropStaleHistory, true);
  assert.deepEqual(policy.referencePriority.explicitReferences, ['current.json']);
  assert.equal(shouldIsolateHistory({ goalSnapshot: { taskRelation: 'new-task' } }), true);
});

test('continuation and repair intents select bounded history scopes', () => {
  const continuePolicy = buildConversationContextPolicy({ goalSnapshot: { taskRelation: 'continue' } });
  assert.equal(continuePolicy.mode, 'continue');
  assert.equal(continuePolicy.historyReuse.allowed, true);
  assert.equal(continuePolicy.historyReuse.scope, 'same-task-recent-turns');

  const repairPolicy = buildConversationContextPolicy({ goalSnapshot: { taskRelation: 'repair' } });
  assert.equal(repairPolicy.mode, 'repair');
  assert.equal(repairPolicy.repairPolicy?.includeFailureEvidence, true);
  assert.equal(repairPolicy.historyReuse.scope, 'previous-run-and-failure-evidence');
});

test('prompt keywords alone do not switch context reuse mode', () => {
  const policy = buildConversationContextPolicy({
    prompt: '继续 previous report latest no execution AgentServer',
  });

  assert.equal(policy.mode, 'isolate');
  assert.equal(policy.historyReuse.allowed, false);
});
