import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRunResumeLifecycleRecoveryFixture,
  buildRunResumeLifecycleRecoveryFixture,
  runResumeLifecycleRecoveryCaseId,
} from './run-resume-lifecycle-recovery.js';

test('R-RUN-01/R-RUN-02/R-RESUME-02 offline fixture covers run/resume lifecycle gaps without claiming a live pass', () => {
  const fixture = buildRunResumeLifecycleRecoveryFixture();

  assertRunResumeLifecycleRecoveryFixture(fixture);
  assert.equal(fixture.caseId, runResumeLifecycleRecoveryCaseId);
  assert.equal(fixture.scope.fixtureLevelOnly, true);
  assert.equal(fixture.scope.livePass, false);
  assert.deepEqual([...fixture.scope.targetTaskIds], ['R-RUN-01', 'R-RUN-02', 'R-RESUME-02']);
  assert.equal(fixture.serviceLifecycle.actualPort, 5181);
  assert.equal(fixture.serviceLifecycle.cleanup.verifiedNotRunning, true);
  assert.equal(fixture.browserRefresh.restoredFrom, 'conversation-projection');
  assert.equal(fixture.cancellation.safeRemainder.resumedFromPartialRef, fixture.cancellation.partialArtifactRef);
  assert.equal(fixture.continuity.distinction.nativeContinuitySatisfiedByRefresh, false);
});

test('R-RUN-01 rejects missing actual-port recovery or stale process still running', () => {
  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      serviceLifecycle: {
        ...buildRunResumeLifecycleRecoveryFixture().serviceLifecycle,
        actualPort: 5173,
        recovery: {
          ...buildRunResumeLifecycleRecoveryFixture().serviceLifecycle.recovery,
          actualPort: 5173,
          healthUrl: 'http://127.0.0.1:5173/health',
        },
      },
    })),
    /actual fallback port/,
  );

  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      serviceLifecycle: {
        ...buildRunResumeLifecycleRecoveryFixture().serviceLifecycle,
        cleanup: {
          ...buildRunResumeLifecycleRecoveryFixture().serviceLifecycle.cleanup,
          verifiedNotRunning: false as true,
          processProbe: {
            pid: 42420,
            running: true,
          },
        },
      },
    })),
    /verified not running/,
  );
});

test('R-RUN-02 rejects unsafe cancellation continuation that repeats completed work', () => {
  const fixture = buildRunResumeLifecycleRecoveryFixture();

  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      cancellation: {
        ...fixture.cancellation,
        safeRemainder: {
          ...fixture.cancellation.safeRemainder,
          repeatedCompletedStepIds: ['load-inputs'],
        },
      },
    })),
    /must not repeat steps/,
  );

  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      cancellation: {
        ...fixture.cancellation,
        safeRemainder: {
          ...fixture.cancellation.safeRemainder,
          resumedFromPartialRef: 'artifact:unrelated',
        },
      },
    })),
    /continue from the partial artifact/,
  );
});

test('R-RESUME-02 rejects refresh evidence that claims native Runtime Codex continuity', () => {
  const fixture = buildRunResumeLifecycleRecoveryFixture();

  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      browserRefresh: {
        ...fixture.browserRefresh,
        nativeSessionContinuityClaimed: true as false,
      },
    })),
    /must not claim native continuity/,
  );

  assert.throws(
    () => assertRunResumeLifecycleRecoveryFixture(buildRunResumeLifecycleRecoveryFixture({
      continuity: {
        ...fixture.continuity,
        distinction: {
          ...fixture.continuity.distinction,
          nativeContinuitySatisfiedByRefresh: true as false,
        },
      },
    })),
    /must not satisfy native Runtime Codex continuity/,
  );
});
