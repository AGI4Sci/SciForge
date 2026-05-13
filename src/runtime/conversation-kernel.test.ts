import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendConversationEvent,
  conversationEventLogDigest,
  createConversationEventLog,
  projectConversation,
  replayConversationState,
  validateBackgroundContinuation,
  validateVerificationGate,
  type ConversationEvent,
} from './conversation-kernel';
import { materializeTaskOutcomeProjection } from './gateway/task-outcome-projection';

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
    foregroundPartialRef: 'artifact:partial-1',
  }), undefined);
  assert.equal(validateBackgroundContinuation({
    status: 'running',
    checkpointRefs: [],
    revisionPlan: '',
  })?.code, 'background-checkpoint-required');
});

test('conversation kernel records background and verification contracts instead of inferring them', () => {
  const base = createConversationEventLog('c-contracts');

  const rejectedBackground = appendConversationEvent(base, {
    id: 'bg-inline',
    type: 'BackgroundRunning',
    storage: 'inline',
    actor: 'kernel',
    timestamp: '2026-05-13T00:00:00.000Z',
    turnId: 't-bg',
    runId: 'r-bg',
    payload: {
      checkpointRefs: ['artifact:checkpoint-inline'],
      revisionPlan: 'continue in background',
      foregroundPartialRef: 'artifact:partial-inline',
    },
  });
  assert.equal(rejectedBackground.rejected?.code, 'background-checkpoint-required');
  assert.equal(rejectedBackground.log.events.length, 0);

  const rejectedVerification = appendConversationEvent(base, {
    id: 'verify-inline',
    type: 'VerificationRecorded',
    storage: 'inline',
    actor: 'verifier',
    timestamp: '2026-05-13T00:00:01.000Z',
    turnId: 't-bg',
    runId: 'r-bg',
    payload: {
      verifierRef: 'artifact:verification-inline',
      verdict: 'supported',
    },
  });
  assert.equal(rejectedVerification.rejected?.code, 'verification-ref-required');
  assert.equal(rejectedVerification.log.events.length, 0);

  let log = appendConversationEvent(base, {
    id: 'turn-bg',
    type: 'TurnReceived',
    storage: 'inline',
    actor: 'user',
    timestamp: '2026-05-13T00:00:02.000Z',
    turnId: 't-bg',
    payload: { prompt: 'continue the long verification in the background' },
  }).log;
  log = appendConversationEvent(log, {
    id: 'bg-running',
    type: 'BackgroundRunning',
    storage: 'ref',
    actor: 'kernel',
    timestamp: '2026-05-13T00:00:03.000Z',
    turnId: 't-bg',
    runId: 'r-bg',
    payload: {
      summary: 'background verifier continues from checkpoint',
      refs: [
        { ref: 'artifact:partial-answer', digest: 'sha256:partial', mime: 'text/markdown', sizeBytes: 128 },
        { ref: 'checkpoint:bg-1', digest: 'sha256:checkpoint', mime: 'application/json', sizeBytes: 96 },
      ],
      revisionPlan: 'verify remaining claims and merge a revised answer',
      foregroundPartialRef: 'artifact:partial-answer',
    },
  }).log;
  log = appendConversationEvent(log, {
    id: 'verify-ref',
    type: 'VerificationRecorded',
    storage: 'ref',
    actor: 'verifier',
    timestamp: '2026-05-13T00:00:04.000Z',
    turnId: 't-bg',
    runId: 'r-bg',
    payload: {
      summary: 'verifier evidence saved',
      refs: [{ ref: 'artifact:verification-evidence', digest: 'sha256:verify', mime: 'application/json', sizeBytes: 64 }],
      verdict: 'supported',
    },
  }).log;

  const state = replayConversationState(log);
  const projection = projectConversation(log, state);

  assert.equal(state.status, 'background-running');
  assert.deepEqual(state.background?.checkpointRefs, ['artifact:partial-answer', 'checkpoint:bg-1']);
  assert.equal(state.background?.revisionPlan, 'verify remaining claims and merge a revised answer');
  assert.equal(state.background?.foregroundPartialRef, 'artifact:partial-answer');
  assert.equal(projection.backgroundState?.foregroundPartialRef, 'artifact:partial-answer');
  assert.equal(projection.verificationState.status, 'verified');
  assert.equal(projection.verificationState.verifierRef, 'artifact:verification-evidence');
  assert.deepEqual(projection.auditRefs, ['artifact:partial-answer', 'checkpoint:bg-1', 'artifact:verification-evidence']);
});

test('conversation projection does not infer background or verification state from answer payloads', () => {
  let log = createConversationEventLog('c-recorded-only');
  log = appendConversationEvent(log, {
    id: 'turn-recorded-only',
    type: 'TurnReceived',
    storage: 'inline',
    actor: 'user',
    timestamp: '2026-05-13T00:00:00.000Z',
    turnId: 't-recorded',
    payload: { prompt: 'show the final answer' },
  }).log;
  log = appendConversationEvent(log, {
    id: 'satisfied-recorded-only',
    type: 'Satisfied',
    storage: 'inline',
    actor: 'backend',
    timestamp: '2026-05-13T00:00:01.000Z',
    turnId: 't-recorded',
    runId: 'r-recorded',
    payload: {
      text: 'Done.',
      verificationRef: 'artifact:should-not-count',
      backgroundState: {
        checkpointRefs: ['checkpoint:should-not-count'],
        revisionPlan: 'this was not recorded as a kernel event',
      },
    },
  }).log;

  const projection = projectConversation(log);

  assert.equal(projection.visibleAnswer?.status, 'satisfied');
  assert.equal(projection.verificationState.status, 'unverified');
  assert.equal(projection.verificationState.verifierRef, undefined);
  assert.equal(projection.backgroundState, undefined);
  assert.deepEqual(projection.auditRefs, []);
});

test('conversation kernel requires dedicated harness decision payload fields', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['harness-decision-id-required', {
      profileId: 'research-grade',
      digest: 'sha256:decision',
      refs: [{ ref: 'runtime://agent-harness/contracts/contract-1' }],
    }],
    ['harness-decision-profile-required', {
      decisionId: 'decision-1',
      digest: 'sha256:decision',
      refs: [{ ref: 'runtime://agent-harness/contracts/contract-1' }],
    }],
    ['harness-decision-digest-required', {
      decisionId: 'decision-1',
      profileId: 'research-grade',
      refs: [{ ref: 'runtime://agent-harness/contracts/contract-1' }],
    }],
    ['harness-decision-ref-required', {
      decisionId: 'decision-1',
      profileId: 'research-grade',
      digest: 'sha256:decision',
      refs: [],
    }],
  ];

  for (const [code, payload] of cases) {
    const result = appendConversationEvent(
      createConversationEventLog(`c-${code}`),
      harnessDecisionEvent(payload),
    );
    assert.equal(result.rejected?.code, code);
    assert.equal(result.log.events.length, 0);
  }
});

test('gateway outcome event log records harness decision before dispatch and replays audit refs', () => {
  const contractRef = 'runtime://agent-harness/contracts/research-grade-contract';
  const traceRef = 'runtime://agent-harness/traces/research-grade-trace';
  const projection = materializeTaskOutcomeProjection({
    payload: {
      message: 'The requested research report is available.',
      confidence: 0.92,
      claimType: 'summary',
      evidenceLevel: 'contract-backed',
      reasoningTrace: '',
      claims: [],
      uiManifest: [],
      executionUnits: [{ id: 'answer', status: 'done', tool: 'workspace-runtime-gateway' }],
      artifacts: [{
        id: 'report-1',
        type: 'research-report',
        title: 'Research report',
        dataRef: 'artifact:report-1',
      }],
      displayIntent: {
        protocolStatus: 'protocol-success',
        taskOutcome: 'satisfied',
        updatedAt: '2026-05-13T02:00:00.000Z',
      },
    },
    request: {
      skillDomain: 'literature',
      prompt: 'Find papers and produce a research report.',
      artifacts: [],
      uiState: {
        agentHarness: {
          decisionId: 'decision-research-grade-1',
          profileId: 'research-grade',
          contractRef,
          traceRef,
          summary: {
            decisionSummary: 'Use research-grade contract and preserve trace refs.',
            profileId: 'research-grade',
            contractRef,
            traceRef,
          },
          contract: { intentMode: 'research', explorationMode: 'evidence-first' },
          trace: { stages: [{ stage: 'onDispatch', callbackId: 'trace:onDispatch' }] },
        },
      },
    },
  });

  assert.deepEqual(
    projection.conversationEventLog.events.slice(0, 3).map((event) => event.type),
    ['TurnReceived', 'HarnessDecisionRecorded', 'Dispatched'],
  );
  const decisionEvent = projection.conversationEventLog.events.find((event) => event.type === 'HarnessDecisionRecorded');
  assert.equal(decisionEvent?.storage, 'ref');
  assert.equal(decisionEvent?.payload.profileId, 'research-grade');
  assert.match(String(decisionEvent?.payload.digest), /^sha256:/);
  assert.deepEqual(
    projection.conversationProjection.auditRefs.filter((ref) => ref === contractRef || ref === traceRef),
    [contractRef, traceRef],
  );
  assert.equal(projection.conversationProjection.harnessDecision?.contractRef, contractRef);
  assert.equal(projection.conversationProjection.harnessDecision?.traceRef, traceRef);

  const replayedState = replayConversationState(projection.conversationEventLog);
  assert.equal(replayedState.harnessDecision?.summary, 'Use research-grade contract and preserve trace refs.');
  assert.deepEqual(
    replayedState.harnessDecision?.refs.filter((ref) => ref === contractRef || ref === traceRef),
    [contractRef, traceRef],
  );
  const replayedProjection = projectConversation(projection.conversationEventLog, replayedState);
  assert.deepEqual(replayedProjection.harnessDecision, projection.conversationProjection.harnessDecision);
  assert.equal(conversationEventLogDigest(projection.conversationEventLog), projection.conversationEventLogDigest);
});

test('conversation kernel replays history edits as projection and ref invalidation boundaries', () => {
  let log = createConversationEventLog('c-history-edit');
  log = appendConversationEvent(log, {
    id: 'history-edit-1',
    type: 'HistoryEdited',
    storage: 'inline',
    actor: 'ui',
    timestamp: '2026-05-13T01:00:00.000Z',
    turnId: 'message:msg-1',
    payload: {
      summary: 'Historical edit reverted downstream work.',
      branchId: 'history-edit-1',
      mode: 'revert',
      sourceMessageRef: 'message:msg-1',
      boundaryAt: '2026-05-13T00:00:00.000Z',
      invalidatedRefs: ['run:r-late', 'artifact:late-report'],
      affectedRefs: ['run:r-late', 'artifact:late-report'],
      projectionInvalidation: {
        schemaVersion: 'sciforge.history-edit-projection-invalidation.v1',
        invalidatesProjection: true,
        staleProjectionRefs: ['artifact:late-report'],
      },
      requiresUserConfirmation: false,
      nextStep: 'Start the next run from the edited message boundary.',
    },
  }).log;

  const state = replayConversationState(log);
  const projection = projectConversation(log, state);

  assert.equal(state.status, 'planned');
  assert.equal(state.historyEdit?.mode, 'revert');
  assert.equal(state.historyEdit?.projectionInvalidated, true);
  assert.deepEqual(state.historyEdit?.invalidatedRefs, ['run:r-late', 'artifact:late-report']);
  assert.equal(projection.historyEdit?.sourceMessageRef, 'message:msg-1');
  assert.match(projection.visibleAnswer?.diagnostic ?? '', /edited message boundary/);
  assert.deepEqual(projection.recoverActions, ['Start the next run from the edited message boundary.']);
  assert.equal(projection.diagnostics[0]?.code, 'history-edit-projection-invalidated');
});

test('conversation kernel requires projection invalidation metadata for history edits', () => {
  const result = appendConversationEvent(createConversationEventLog('c-history-invalid'), {
    id: 'history-edit-missing-projection',
    type: 'HistoryEdited',
    storage: 'inline',
    actor: 'ui',
    timestamp: '2026-05-13T01:00:00.000Z',
    payload: {
      branchId: 'history-edit-missing-projection',
      mode: 'continue',
      sourceMessageRef: 'message:msg-1',
      boundaryAt: '2026-05-13T00:00:00.000Z',
      affectedRefs: ['run:r-late'],
      invalidatedRefs: [],
    },
  });

  assert.equal(result.rejected?.code, 'history-edit-projection-invalidation-required');
  assert.equal(result.log.events.length, 0);
});

function harnessDecisionEvent(payload: Record<string, unknown>): ConversationEvent {
  return {
    id: `event-${String(payload.decisionId ?? 'missing')}`,
    type: 'HarnessDecisionRecorded',
    storage: 'ref',
    actor: 'kernel',
    timestamp: '2026-05-13T02:00:00.000Z',
    payload,
  } as ConversationEvent;
}
