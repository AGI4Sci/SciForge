import assert from 'node:assert/strict';
import test from 'node:test';

import { planConversationHandoff } from './conversation-handoff-planner.js';

test('handoff planner emits selected refs and omits forbidden legacy context fields', () => {
  const plan = planConversationHandoff({
    prompt: 'Use the selected refs only.',
    currentReferenceDigests: [{ ref: 'artifact:current-digest', digest: 'sha256:current' }],
    artifacts: [
      { id: 'a1', type: 'report', dataRef: 'artifact:duplicate-report' },
      { id: 'a1', type: 'report', dataRef: 'artifact:duplicate-report' },
    ],
    handoffMemoryProjection: {
      authority: 'workspace-project-session-memory',
      stablePrefixHash: 'sha256:stable',
      contextRefs: ['ledger-event:turn-1'],
      selectedContextRefs: ['artifact:current-digest'],
      retrievalTools: ['read_ref'],
      recentConversation: [{
        id: 'm1',
        refs: ['artifact:current-digest'],
        rawHistory: ['old raw turn'],
        rawBody: 'RAW_MESSAGE_BODY',
        compactionState: { status: 'old' },
      }],
      recentRuns: [{
        id: 'run-1',
        refs: ['artifact:current-digest'],
        fullRefList: ['artifact:everything'],
        body: 'RAW_RUN_BODY',
        recentTurns: [{ role: 'assistant', content: 'old answer' }],
      }],
    },
  });

  assert.equal(plan.ok, true);
  const projection = plan.payload?.handoffMemoryProjection as Record<string, unknown>;
  assert.ok(Array.isArray(projection.selectedMessageRefs));
  assert.ok(Array.isArray(projection.selectedRunRefs));
  assert.equal('recentConversation' in projection, false);
  assert.equal('recentRuns' in projection, false);
  assert.doesNotMatch(JSON.stringify(plan.payload), /rawHistory|fullRefList|recentTurns|compactionState|rawBody|\"body\"|RAW_MESSAGE_BODY|RAW_RUN_BODY/);
  assert.equal((plan.payload?.artifacts as unknown[] | undefined)?.length, 1);
  assert.ok(plan.decisions.some((decision) => String(decision.kind) === 'handoff-projection-legacy-key'));
  assert.ok(plan.decisions.some((decision) => String(decision.kind) === 'forbidden-field'));
});
