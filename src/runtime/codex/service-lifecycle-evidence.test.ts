import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION,
  planServiceLifecycleRecovery,
  validateServiceLifecycleEvidenceLedger,
  type ServiceLifecycleEvidenceLedger,
} from './service-lifecycle-evidence.js';

test('R-RUN-01 accepts recovered actual port with cleanup, restart, refresh, readiness, and pass claim evidence', () => {
  const ledger = lifecycleLedger();

  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const plan = planServiceLifecycleRecovery(ledger, {
    serviceName: 'sciforge-ui',
    defaultPort: 5173,
    preferredRole: 'main-orchestrator',
    codeChanged: true,
  });

  assert.equal(plan.ok, true, plan.errors.join('\n'));
  assert.equal(plan.actualPort, 5179);
  assert.equal(plan.url, 'http://localhost:5179/');
  assert.equal(plan.ready, true);
  assert.equal(plan.claimable, true);
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.evidenceRefs.includes('audit:cleanup-5173'));
  assert.ok(plan.evidenceRefs.includes('browser:refresh-5179'));
});

test('R-RUN-01 rejects pass claims that assume the default port and omit cleanup or refresh evidence', () => {
  const ledger = lifecycleLedger({
    portBindings: [
      {
        role: 'main-orchestrator',
        defaultPort: 5173,
        actualPort: 5179,
        url: 'http://localhost:5179/',
        assignedBy: 'manual-recovery',
        conflictWithDefault: true,
      },
    ],
    staleProcessCleanup: [],
    browserRefreshes: [],
    passClaims: [
      {
        claimId: 'claim:bad-default-assumption',
        status: 'pass',
        claimedUrl: 'http://localhost:5173/',
        claimedPort: 5173,
        assumesDefaultPort: true,
        evidenceRefs: ['claim:bad-default-assumption'],
      },
    ],
  });

  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /cannot claim pass by assuming the default port/);
  assert.match(validation.errors.join('\n'), /without staleProcessCleanup evidence/);
  assert.match(validation.errors.join('\n'), /without browser refresh evidence/);
  assert.match(validation.errors.join('\n'), /claimedPort 5173 does not match any recorded actual port/);
});

test('R-RUN-01 plans missing service lifecycle recovery evidence before a pass can be claimed', () => {
  const ledger = lifecycleLedger({
    portConflictRecovery: [],
    codeChangeRestarts: [],
    browserRefreshes: [],
    readinessChecks: [
      {
        checkId: 'ready:failed',
        url: 'http://localhost:5179/',
        port: 5179,
        status: 'fail',
        checkedAt: '2026-05-20T09:03:00.000Z',
        responseStatus: 503,
        detail: 'dev server restarted but app was not ready yet',
        evidenceRefs: ['readiness:failed'],
      },
    ],
    passClaims: [],
  });

  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const plan = planServiceLifecycleRecovery(ledger, {
    serviceName: 'sciforge-ui',
    defaultPort: 5173,
    preferredRole: 'main-orchestrator',
    codeChanged: true,
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.claimable, false);
  assert.deepEqual(
    plan.steps.map((step) => step.action),
    [
      'recover-port-conflict',
      'restart-after-code-change',
      'check-readiness',
      'refresh-browser',
      'record-pass-claim',
    ],
  );
  assert.match(plan.steps.map((step) => step.reason).join('\n'), /Actual port 5179 differs from default port 5173/);
});

test('R-RUN-01 requires readiness checks and claims to name the actual URL port', () => {
  const ledger = lifecycleLedger({
    readinessChecks: [
      {
        checkId: 'ready:mismatch',
        url: 'http://localhost:5173/',
        port: 5179,
        status: 'pass',
        checkedAt: '2026-05-20T09:03:00.000Z',
        responseStatus: 200,
        evidenceRefs: ['readiness:mismatch'],
      },
    ],
    passClaims: [
      {
        claimId: 'claim:mismatch',
        status: 'pass',
        claimedUrl: 'http://localhost:5173/',
        claimedPort: 5179,
        assumesDefaultPort: false,
        evidenceRefs: ['claim:mismatch'],
      },
    ],
  });

  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /readinessChecks\[0\]\.url port 5173 does not match recorded port 5179/);
  assert.match(validation.errors.join('\n'), /passClaims\[0\]\.claimedUrl port 5173 does not match recorded port 5179/);
});

function lifecycleLedger(overrides: Partial<ServiceLifecycleEvidenceLedger> = {}): ServiceLifecycleEvidenceLedger {
  return {
    schemaVersion: SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION,
    runId: 'run:r-run-01',
    serviceName: 'sciforge-ui',
    defaultPort: 5173,
    portBindings: [
      {
        role: 'main-orchestrator',
        defaultPort: 5173,
        actualPort: 5179,
        url: 'http://localhost:5179/',
        assignedBy: 'manual-recovery',
        conflictWithDefault: true,
        evidenceRefs: ['port:actual-5179'],
      },
    ],
    staleProcessCleanup: [
      {
        cleanupId: 'cleanup:stale-5173',
        port: 5173,
        action: 'terminated',
        pid: 41234,
        command: 'vite --host 127.0.0.1 --port 5173',
        verifiedAt: '2026-05-20T09:00:00.000Z',
        evidenceRefs: ['audit:cleanup-5173'],
      },
    ],
    portConflictRecovery: [
      {
        recoveryId: 'recovery:5173-to-5179',
        requestedPort: 5173,
        actualPort: 5179,
        reason: 'stale-process-on-port',
        detectedBy: 'port-preflight',
        staleCleanupIds: ['cleanup:stale-5173'],
        evidenceRefs: ['audit:port-recovery-5179'],
      },
    ],
    codeChangeRestarts: [
      {
        restartId: 'restart:after-code-change',
        trigger: 'file-change',
        changeRef: 'git-diff:src/runtime/codex/service-lifecycle-evidence.ts',
        previousUrl: 'http://localhost:5179/',
        restartedUrl: 'http://localhost:5179/',
        observedAt: '2026-05-20T09:02:00.000Z',
        evidenceRefs: ['audit:restart-after-code-change'],
      },
    ],
    browserRefreshes: [
      {
        refreshId: 'refresh:codex-browser-5179',
        method: 'codex-in-app-browser',
        beforeUrl: 'http://localhost:5179/',
        afterUrl: 'http://localhost:5179/',
        refreshedAt: '2026-05-20T09:04:00.000Z',
        observedContent: 'SciForge default chat entry visible after refresh',
        evidenceRefs: ['browser:refresh-5179'],
      },
    ],
    readinessChecks: [
      {
        checkId: 'ready:5179',
        url: 'http://localhost:5179/',
        port: 5179,
        status: 'pass',
        checkedAt: '2026-05-20T09:03:00.000Z',
        responseStatus: 200,
        evidenceRefs: ['readiness:5179'],
      },
    ],
    passClaims: [
      {
        claimId: 'claim:actual-port-pass',
        status: 'pass',
        claimedUrl: 'http://localhost:5179/',
        claimedPort: 5179,
        assumesDefaultPort: false,
        evidenceRefs: ['claim:actual-port-pass'],
      },
    ],
    auditRefs: ['audit:service-lifecycle-r-run-01'],
    ...overrides,
  };
}
