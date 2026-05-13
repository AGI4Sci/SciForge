import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendConversationEvent,
  createConversationEventLog,
  projectConversation,
  replayConversationState,
  validateBackgroundContinuation,
  validateVerificationGate,
} from './conversation-kernel';

test('conversation kernel rejects large inline payloads and requires refs for large evidence', () => {
  const log = createConversationEventLog('c-large');
  const result = appendConversationEvent(log, {
    id: 'evt-large',
    type: 'OutputMaterialized',
    storage: 'inline',
    actor: 'runtime',
    timestamp: '2026-05-13T00:00:00.000Z',
    payload: {
      text: 'x'.repeat(9000),
    },
  });

  assert.equal(result.log.events.length, 0);
  assert.equal(result.rejected?.code, 'inline-payload-too-large');
});

test('conversation kernel replays external failure into projection without code repair as first action', () => {
  let log = createConversationEventLog('c-failure');
  log = appendConversationEvent(log, {
    id: 'turn-1',
    type: 'TurnReceived',
    storage: 'inline',
    actor: 'user',
    timestamp: '2026-05-13T00:00:00.000Z',
    turnId: 't1',
    payload: { prompt: 'download papers' },
  }).log;
  log = appendConversationEvent(log, {
    id: 'run-1',
    type: 'Dispatched',
    storage: 'inline',
    actor: 'kernel',
    timestamp: '2026-05-13T00:00:01.000Z',
    turnId: 't1',
    runId: 'r1',
    payload: { summary: 'dispatched' },
  }).log;
  log = appendConversationEvent(log, {
    id: 'fail-1',
    type: 'ExternalBlocked',
    storage: 'ref',
    actor: 'runtime',
    timestamp: '2026-05-13T00:00:02.000Z',
    turnId: 't1',
    runId: 'r1',
    payload: {
      summary: 'provider closed connection',
      reason: 'Remote end closed connection without response',
      refs: [{ ref: 'file:.sciforge/logs/task.stderr.log', digest: 'sha256:abc' }],
    },
  }).log;

  const state = replayConversationState(log);
  const projection = projectConversation(log, state);

  assert.equal(state.status, 'external-blocked');
  assert.equal(state.failureOwner?.ownerLayer, 'external-provider');
  assert.equal(state.failureOwner?.action, 'retry-after-backoff');
  assert.deepEqual(projection.activeRun, { id: 'r1', status: 'external-blocked' });
  assert.equal(projection.currentTurn?.prompt, 'download papers');
  assert.equal(projection.auditRefs[0], 'file:.sciforge/logs/task.stderr.log');
  assert.match(projection.recoverActions[0], /Retry after provider recovery/);
});

test('conversation kernel validates verification and background restoration contracts', () => {
  assert.equal(validateVerificationGate({
    required: true,
    verification: { status: 'verified', verifierRef: 'artifact:verification-1' },
  }), undefined);
  assert.equal(validateVerificationGate({
    required: true,
    verification: { status: 'verified' },
  })?.code, 'verification-ref-required');
  assert.equal(validateBackgroundContinuation({
    status: 'running',
    checkpointRefs: ['artifact:partial-1'],
    revisionPlan: 'continue verifier',
  }), undefined);
  assert.equal(validateBackgroundContinuation({
    status: 'running',
    checkpointRefs: [],
  })?.code, 'background-checkpoint-required');
});
