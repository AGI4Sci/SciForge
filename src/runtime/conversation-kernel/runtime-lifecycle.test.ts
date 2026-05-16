import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEventRelay,
  createRunStateMachine,
  createTurnPipeline,
  createWorkspaceKernel,
  createWriteAheadSpool,
  normalizeHarnessPolicyRefs,
  normalizeRuntimeFailure,
  replayConversationState,
} from './index';

test('TurnPipeline executes declarative stages and records replayable run-status events', async () => {
  const kernel = createWorkspaceKernel({ sessionId: 'runtime-pipeline-main' });
  const stageOrder: string[] = [];
  const pipeline = createTurnPipeline({
    kernel,
    now: fixedNow(),
    hooks: {
      requestContext(input) {
        stageOrder.push('requestContext');
        assert.equal(input.currentTurnRef, 'ref:turn-main');
        return { contextRef: 'ref:context-main', contextRefs: ['ref:context-main'] };
      },
      driveRun(input) {
        stageOrder.push('driveRun');
        assert.equal(input.contextRef, 'ref:context-main');
        return { status: 'succeeded', resultRefs: ['artifact:final-report'] };
      },
      finalizeRun(input) {
        stageOrder.push('finalizeRun');
        assert.deepEqual(input.resultRefs, ['artifact:final-report']);
        return { status: 'satisfied', text: 'Done from declarative TurnPipeline.', artifactRefs: input.resultRefs };
      },
    },
  });

  assert.deepEqual(pipeline.definition.stages, ['registerTurn', 'requestContext', 'driveRun', 'finalizeRun']);
  assert.equal(pipeline.definition.executorPolicy.forbidUserTextInspection, true);

  const result = await pipeline.execute({
    turnId: 'turn-main',
    runId: 'run-main',
    currentTurnRef: 'ref:turn-main',
    harnessPolicyRefs: normalizeHarnessPolicyRefs({
      schemaVersion: 'sciforge.harness-policy-refs.v1',
      decisionRef: 'runtime://agent-harness/decisions/main',
      contractRef: 'runtime://agent-harness/contracts/main',
      traceRef: 'runtime://agent-harness/traces/main',
      contextRefs: [],
    }),
  });

  assert.deepEqual(stageOrder, ['requestContext', 'driveRun', 'finalizeRun']);
  assert.equal(result.projection.visibleAnswer?.text, 'Done from declarative TurnPipeline.');
  assert.equal(result.projection.activeRun?.status, 'satisfied');
  assert.deepEqual(
    result.projection.executionProcess.map((event) => event.type),
    [
      'TurnReceived',
      'RunStatusRecorded',
      'RunStatusRecorded',
      'RunStatusRecorded',
      'Satisfied',
    ],
  );
});

test('RunStateMachine appends status/checkpoint events and recovers from Projection', () => {
  const kernel = createWorkspaceKernel({ sessionId: 'runtime-run-state' });
  const machine = createRunStateMachine({ kernel, now: fixedNow() });

  machine.appendStatus({ eventId: 'run-state-running', runId: 'run-state', turnId: 'turn-state', status: 'running' });
  const checkpoint = machine.appendCheckpoint({
    eventId: 'run-state-checkpoint',
    runId: 'run-state',
    turnId: 'turn-state',
    checkpointRefs: [{ ref: 'checkpoint:run-state-1', digest: 'sha256:checkpoint' }],
  });
  const failed = normalizeRuntimeFailure({
    failureClass: 'runtime',
    owner: 'runtime',
    reason: 'runner exited before writing output',
    evidenceRefs: ['checkpoint:run-state-1'],
  });
  const terminal = machine.appendStatus({
    eventId: 'run-state-failed',
    runId: 'run-state',
    turnId: 'turn-state',
    status: 'failed',
    failure: failed,
  });

  assert.equal(checkpoint.projection.activeRun?.status, 'partial-ready');
  assert.equal(terminal.projection.activeRun?.status, 'repair-needed');
  assert.equal(terminal.projection.visibleAnswer?.status, 'repair-needed');
  assert.equal(replayConversationState({
    schemaVersion: 'sciforge.conversation-event-log.v1',
    conversationId: terminal.projection.conversationId,
    events: [],
  }).status, 'idle');

  const recovered = machine.recoverFromProjection(terminal.projection);
  assert.equal(recovered?.runId, 'run-state');
  assert.equal(recovered?.status, 'failed');
  assert.equal(recovered?.projectionVersion, 3);
});

test('EventRelay provides producerSeq cursor resume and idempotent tool result reuse', () => {
  const relay = createEventRelay<{ type: string }>({ producerId: 'producer-main' });
  const first = relay.emit({ type: 'started' });
  const second = relay.emit({ type: 'progress' });

  assert.equal(first.identity.producerSeq, 1);
  assert.equal(second.identity.cursor, 'producer-main:2');
  assert.deepEqual(relay.replayAfter(first.identity.cursor).map((event) => event.event.type), ['progress']);

  let sideEffects = 0;
  const key = { callId: 'call-1', inputDigest: 'sha256:input', routeDigest: 'sha256:route' };
  const firstResult = relay.executeToolCall(key, () => {
    sideEffects += 1;
    return { resultRefs: ['artifact:tool-result'] };
  });
  const reusedResult = relay.executeToolCall(key, () => {
    sideEffects += 1;
    return { resultRefs: ['artifact:should-not-run'] };
  });

  assert.equal(sideEffects, 1);
  assert.equal(firstResult.reused, false);
  assert.equal(reusedResult.reused, true);
  assert.deepEqual(reusedResult.resultRefs, ['artifact:tool-result']);
});

test('WriteAheadSpool fails closed as storage-unavailable when bounded depth or age is exceeded', () => {
  let clock = 1000;
  const spool = createWriteAheadSpool({
    limits: { maxDepth: 2, maxAgeMs: 50 },
    now: () => clock,
  });

  assert.equal(spool.append({ id: 'event:1', refs: ['ref:1'] }).ok, true);
  assert.equal(spool.append({ id: 'event:2', refs: ['ref:2'] }).ok, true);
  const depthFailure = spool.append({ id: 'event:3', refs: ['ref:3'] });
  assert.equal(depthFailure.ok, false);
  assert.equal(depthFailure.failure.failureClass, 'storage-unavailable');
  assert.equal(depthFailure.failure.recoverability, 'fail-closed');

  spool.drain();
  assert.equal(spool.append({ id: 'event:4', refs: ['ref:4'] }).ok, true);
  clock = 1100;
  const ageFailure = spool.append({ id: 'event:5', refs: ['ref:5'] });
  assert.equal(ageFailure.ok, false);
  assert.equal(ageFailure.failure.failureClass, 'storage-unavailable');
});

test('FailureNormalizer emits stable failure class, recoverability, owner, and signature', () => {
  const first = normalizeRuntimeFailure({
    reason: 'schema validation failed for materialized payload',
    evidenceRefs: ['artifact:bad-payload'],
  });
  const second = normalizeRuntimeFailure({
    reason: 'schema validation failed for materialized payload',
    evidenceRefs: ['artifact:bad-payload'],
  });

  assert.equal(first.failureClass, 'validation');
  assert.equal(first.recoverability, 'repairable');
  assert.equal(first.owner, 'gateway');
  assert.match(first.failureSignature, /^sha256:/);
  assert.equal(first.failureSignature, second.failureSignature);
});

test('Harness policy refs are context refs only and do not expose semantic policy bodies', () => {
  const refs = normalizeHarnessPolicyRefs({
    schemaVersion: 'sciforge.harness-policy-refs.v1',
    decisionRef: 'runtime://agent-harness/decisions/1',
    contractRef: 'runtime://agent-harness/contracts/1',
    traceRef: 'runtime://agent-harness/traces/1',
    contextRefs: ['runtime://agent-harness/contracts/1'],
  });

  assert.deepEqual(refs.contextRefs, [
    'runtime://agent-harness/decisions/1',
    'runtime://agent-harness/contracts/1',
    'runtime://agent-harness/traces/1',
  ]);
  assert.equal(Object.hasOwn(refs as unknown as Record<string, unknown>, 'policy'), false);
  assert.equal(Object.hasOwn(refs as unknown as Record<string, unknown>, 'domainSemantics'), false);
});

function fixedNow() {
  return () => '2026-05-16T00:00:00.000Z';
}
