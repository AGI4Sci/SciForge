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
    contextProjection: {
      authority: 'workspace-kernel-context-projection',
      stablePrefixHash: 'sha256:stable',
      contextRefs: ['ledger-event:turn-1'],
      capabilityBriefRef: { ref: 'projection:capability-brief', kind: 'projection', digest: 'sha256:brief', sizeBytes: 12 },
      cachePlan: {
        stablePrefixRefs: [{ ref: 'projection:stable', kind: 'projection', digest: 'sha256:stable', sizeBytes: 12 }],
        perTurnPayloadRefs: [{ ref: 'ledger-event:turn-1', kind: 'ledger-event', digest: 'sha256:turn', sizeBytes: 12 }],
      },
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
  const projection = plan.payload?.contextProjection as Record<string, unknown>;
  assert.ok(Array.isArray(projection.selectedMessageRefs));
  assert.ok(Array.isArray(projection.selectedRunRefs));
  assert.equal('recentConversation' in projection, false);
  assert.equal('recentRuns' in projection, false);
  assert.equal('handoffMemoryProjection' in (plan.payload ?? {}), false);
  assert.ok(isRecord(projection.capabilityBriefRef));
  assert.ok(isRecord(projection.cachePlan));
  assert.doesNotMatch(JSON.stringify(plan.payload), /rawHistory|fullRefList|recentTurns|compactionState|rawBody|\"body\"|RAW_MESSAGE_BODY|RAW_RUN_BODY/);
  assert.equal((plan.payload?.artifacts as unknown[] | undefined)?.length, 1);
  assert.ok(plan.decisions.some((decision) => String(decision.kind) === 'context-projection-legacy-key'));
  assert.ok(plan.decisions.some((decision) => String(decision.kind) === 'forbidden-field'));
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
