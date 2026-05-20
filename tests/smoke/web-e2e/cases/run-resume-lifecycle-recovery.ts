import assert from 'node:assert/strict';

export const runResumeLifecycleRecoveryCaseId = 'SA-WEB-37-run-resume-lifecycle-recovery';

export type RunResumeLifecycleTarget = 'R-RUN-01' | 'R-RUN-02' | 'R-RESUME-02';

export interface RunResumeGuiState {
  sessionId: string;
  route: string;
  selectedArtifactRefs: readonly string[];
  visibleAnswerText: string;
  activeRunId?: string;
  activeRunStatus?: 'running' | 'cancelled' | 'satisfied';
}

export interface RunResumeLifecycleRecoveryFixture {
  schemaVersion: 'sciforge.web-e2e.run-resume-lifecycle-recovery.v1';
  caseId: typeof runResumeLifecycleRecoveryCaseId;
  scope: {
    targetTaskIds: readonly RunResumeLifecycleTarget[];
    fixtureLevelOnly: true;
    livePass: false;
    source: 'offline-web-e2e-fixture';
  };
  serviceLifecycle: {
    serviceId: string;
    requestedPort: number;
    blockedPort: number;
    actualPort: number;
    staleProcess: {
      pid: number;
      port: number;
      command: string;
    };
    cleanup: {
      attempted: true;
      signal: 'SIGTERM';
      verifiedNotRunning: true;
      processProbe: {
        pid: number;
        running: boolean;
      };
      portProbe: {
        port: number;
        status: 'connection-refused' | 'closed';
      };
    };
    recovery: {
      started: true;
      actualPort: number;
      healthUrl: string;
      healthStatus: 'ok';
      recoveredFromPortConflict: true;
    };
  };
  browserRefresh: {
    action: 'page.reload';
    evidenceRef: string;
    before: RunResumeGuiState;
    after: RunResumeGuiState;
    restoredFrom: 'conversation-projection';
    nativeSessionContinuityClaimed: false;
  };
  cancellation: {
    runId: string;
    requested: true;
    acknowledged: true;
    partialArtifactRef: string;
    completedStepIdsBeforeCancel: readonly string[];
    safeRemainder: {
      continuationRunId: string;
      resumedFromPartialRef: string;
      remainingStepIds: readonly string[];
      repeatedCompletedStepIds: readonly string[];
      completed: true;
    };
  };
  continuity: {
    browserRefreshRestores: 'gui-state';
    nativeContinuityRequires: 'codex-session-id';
    nativeContinuity: {
      status: 'out-of-scope';
      codexSessionId: null;
      resumeMetadataRef: null;
    };
    distinction: {
      browserRefreshRestoredGuiState: true;
      browserRefreshClaimedNativeContinuity: false;
      nativeContinuitySatisfiedByRefresh: false;
    };
  };
}

export function buildRunResumeLifecycleRecoveryFixture(
  overrides: Partial<RunResumeLifecycleRecoveryFixture> = {},
): RunResumeLifecycleRecoveryFixture {
  const before: RunResumeGuiState = {
    sessionId: 'session-run-resume-offline',
    route: '/chat/session-run-resume-offline',
    selectedArtifactRefs: ['artifact:cancelled-run-partial'],
    visibleAnswerText: 'Partial result is preserved after cancellation.',
    activeRunId: 'run-r-run-02-cancelled',
    activeRunStatus: 'cancelled',
  };
  const after: RunResumeGuiState = {
    ...before,
    visibleAnswerText: 'Partial result is preserved after cancellation.',
  };

  return {
    schemaVersion: 'sciforge.web-e2e.run-resume-lifecycle-recovery.v1',
    caseId: runResumeLifecycleRecoveryCaseId,
    scope: {
      targetTaskIds: ['R-RUN-01', 'R-RUN-02', 'R-RESUME-02'],
      fixtureLevelOnly: true,
      livePass: false,
      source: 'offline-web-e2e-fixture',
    },
    serviceLifecycle: {
      serviceId: 'runtime-codex-browser-acceptance-fixture',
      requestedPort: 5173,
      blockedPort: 5173,
      actualPort: 5181,
      staleProcess: {
        pid: 42420,
        port: 5173,
        command: 'node stale-runtime-codex-service.js',
      },
      cleanup: {
        attempted: true,
        signal: 'SIGTERM',
        verifiedNotRunning: true,
        processProbe: {
          pid: 42420,
          running: false,
        },
        portProbe: {
          port: 5173,
          status: 'connection-refused',
        },
      },
      recovery: {
        started: true,
        actualPort: 5181,
        healthUrl: 'http://127.0.0.1:5181/health',
        healthStatus: 'ok',
        recoveredFromPortConflict: true,
      },
    },
    browserRefresh: {
      action: 'page.reload',
      evidenceRef: 'evidence:browser-refresh-restored-gui-state',
      before,
      after,
      restoredFrom: 'conversation-projection',
      nativeSessionContinuityClaimed: false,
    },
    cancellation: {
      runId: 'run-r-run-02-cancelled',
      requested: true,
      acknowledged: true,
      partialArtifactRef: 'artifact:cancelled-run-partial',
      completedStepIdsBeforeCancel: ['load-inputs', 'derive-initial-table'],
      safeRemainder: {
        continuationRunId: 'run-r-run-02-safe-remainder',
        resumedFromPartialRef: 'artifact:cancelled-run-partial',
        remainingStepIds: ['validate-table', 'write-final-summary'],
        repeatedCompletedStepIds: [],
        completed: true,
      },
    },
    continuity: {
      browserRefreshRestores: 'gui-state',
      nativeContinuityRequires: 'codex-session-id',
      nativeContinuity: {
        status: 'out-of-scope',
        codexSessionId: null,
        resumeMetadataRef: null,
      },
      distinction: {
        browserRefreshRestoredGuiState: true,
        browserRefreshClaimedNativeContinuity: false,
        nativeContinuitySatisfiedByRefresh: false,
      },
    },
    ...overrides,
  };
}

export function assertRunResumeLifecycleRecoveryFixture(
  fixture: RunResumeLifecycleRecoveryFixture,
): void {
  assert.equal(fixture.schemaVersion, 'sciforge.web-e2e.run-resume-lifecycle-recovery.v1');
  assert.equal(fixture.caseId, runResumeLifecycleRecoveryCaseId);
  assert.deepEqual([...fixture.scope.targetTaskIds], ['R-RUN-01', 'R-RUN-02', 'R-RESUME-02']);
  assert.equal(fixture.scope.fixtureLevelOnly, true, 'run/resume gap fixture must stay fixture-level only');
  assert.equal(fixture.scope.livePass, false, 'run/resume gap fixture must not claim a live pass');

  assertActualPortRecovery(fixture);
  assertStaleProcessCleanup(fixture);
  assertBrowserRefreshRestoresGuiState(fixture);
  assertCancellationSafeRemainder(fixture);
  assertRefreshNativeContinuityDistinction(fixture);
}

export function assertActualPortRecovery(fixture: RunResumeLifecycleRecoveryFixture): void {
  const lifecycle = fixture.serviceLifecycle;
  assert.equal(lifecycle.blockedPort, lifecycle.requestedPort, 'fixture must model the requested port as blocked');
  assert.notEqual(lifecycle.actualPort, lifecycle.requestedPort, 'recovered service must report the actual fallback port');
  assert.equal(lifecycle.recovery.actualPort, lifecycle.actualPort, 'recovery evidence must use the same actual port');
  assert.match(lifecycle.recovery.healthUrl, new RegExp(`:${lifecycle.actualPort}/`), 'health URL must point at the actual port');
  assert.equal(lifecycle.recovery.healthStatus, 'ok', 'recovered service must have offline health evidence');
  assert.equal(lifecycle.recovery.recoveredFromPortConflict, true, 'fixture must identify port-conflict recovery');
}

export function assertStaleProcessCleanup(fixture: RunResumeLifecycleRecoveryFixture): void {
  const { cleanup, staleProcess } = fixture.serviceLifecycle;
  assert.equal(cleanup.attempted, true, 'stale process cleanup must be attempted');
  assert.equal(cleanup.processProbe.pid, staleProcess.pid, 'cleanup probe must target the stale process pid');
  assert.equal(cleanup.processProbe.running, false, 'stale process must be verified not running');
  assert.equal(cleanup.verifiedNotRunning, true, 'cleanup must carry verified not-running evidence');
  assert.equal(cleanup.portProbe.port, staleProcess.port, 'port probe must verify the stale service port');
  assert.ok(['connection-refused', 'closed'].includes(cleanup.portProbe.status), 'stale service port must be closed');
}

export function assertBrowserRefreshRestoresGuiState(fixture: RunResumeLifecycleRecoveryFixture): void {
  const refresh = fixture.browserRefresh;
  assert.equal(refresh.action, 'page.reload');
  assert.ok(refresh.evidenceRef.startsWith('evidence:'), 'browser refresh must carry an evidence ref');
  assert.equal(refresh.restoredFrom, 'conversation-projection', 'browser refresh must restore from GUI projection state');
  assert.equal(refresh.after.sessionId, refresh.before.sessionId, 'refresh must keep the GUI session');
  assert.equal(refresh.after.route, refresh.before.route, 'refresh must keep the GUI route');
  assert.deepEqual([...refresh.after.selectedArtifactRefs], [...refresh.before.selectedArtifactRefs], 'refresh must restore selected refs');
  assert.equal(refresh.after.visibleAnswerText, refresh.before.visibleAnswerText, 'refresh must restore visible answer text');
}

export function assertCancellationSafeRemainder(fixture: RunResumeLifecycleRecoveryFixture): void {
  const cancellation = fixture.cancellation;
  assert.equal(cancellation.requested, true, 'cancellation must be requested');
  assert.equal(cancellation.acknowledged, true, 'cancellation must be acknowledged before continuation');
  assert.ok(cancellation.partialArtifactRef, 'cancelled run must preserve a partial artifact ref');
  assert.equal(
    cancellation.safeRemainder.resumedFromPartialRef,
    cancellation.partialArtifactRef,
    'safe remainder must continue from the partial artifact',
  );
  assert.equal(cancellation.safeRemainder.completed, true, 'safe remainder continuation must complete');
  assert.deepEqual(
    [...cancellation.safeRemainder.repeatedCompletedStepIds],
    [],
    'safe remainder must not repeat steps completed before cancellation',
  );
  const completed = new Set(cancellation.completedStepIdsBeforeCancel);
  assert.equal(
    cancellation.safeRemainder.remainingStepIds.some((stepId) => completed.has(stepId)),
    false,
    'remaining steps must exclude completed steps',
  );
}

export function assertRefreshNativeContinuityDistinction(fixture: RunResumeLifecycleRecoveryFixture): void {
  assert.equal(fixture.continuity.browserRefreshRestores, 'gui-state');
  assert.equal(fixture.continuity.nativeContinuityRequires, 'codex-session-id');
  assert.equal(fixture.browserRefresh.nativeSessionContinuityClaimed, false, 'refresh evidence must not claim native continuity');
  assert.equal(fixture.continuity.nativeContinuity.status, 'out-of-scope', 'native continuity must remain out of scope for this fixture');
  assert.equal(fixture.continuity.nativeContinuity.codexSessionId, null, 'fixture must not synthesize a native codexSessionId');
  assert.equal(fixture.continuity.distinction.browserRefreshRestoredGuiState, true);
  assert.equal(
    fixture.continuity.distinction.browserRefreshClaimedNativeContinuity,
    false,
    'browser refresh distinction must not claim native continuity',
  );
  assert.equal(
    fixture.continuity.distinction.nativeContinuitySatisfiedByRefresh,
    false,
    'browser refresh must not satisfy native Runtime Codex continuity',
  );
}
