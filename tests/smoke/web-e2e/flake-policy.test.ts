import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

import {
  buildWebE2eMinimalReproCommand,
  createWebE2eFlakeFailureReport,
  enforceWebE2eFlakePolicy,
  formatWebE2eFlakePolicyReport,
  WebE2eFlakePolicyError,
  type WebE2eCaseAttempt,
} from './flake-policy.js';

const cwd = resolve('.');
const manifestPath = join(cwd, 'docs/test-artifacts/web-e2e/SA-WEB-26/manifest.json');
const firstScreenshotPath = join(cwd, 'docs/test-artifacts/web-e2e/SA-WEB-26/screenshots/round-1.png');
const lastScreenshotPath = join(cwd, 'docs/test-artifacts/web-e2e/SA-WEB-26/screenshots/failure.png');

const failedAttempt: WebE2eCaseAttempt = {
  caseId: 'SA-WEB-26',
  attempt: 1,
  status: 'failed',
  seed: 'seed with spaces',
  caseManifest: {
    path: manifestPath,
    digest: 'sha256:manifest',
  },
  instrumentation: {
    schemaVersion: 1,
    label: 'SA-WEB-26',
    capturedAt: '2026-05-16T00:00:03.000Z',
    counts: {
      consoleWarnings: 0,
      consoleErrors: 0,
      pageErrors: 0,
      requestFailures: 0,
      responseFailures: 0,
      screenshots: 2,
      domSnapshots: 0,
      downloads: 0,
    },
    hasFailures: false,
    events: [],
    evidence: [
      {
        kind: 'screenshot',
        id: 'round-1',
        path: firstScreenshotPath,
        fullPage: true,
        timestamp: '2026-05-16T00:00:01.000Z',
      },
      {
        kind: 'screenshot',
        id: 'failure',
        path: lastScreenshotPath,
        fullPage: true,
        timestamp: '2026-05-16T00:00:02.000Z',
      },
    ],
  },
  contractFailures: [
    {
      contractId: 'sciforge.current-task.v1',
      message: 'currentTask.currentTurnRef drifted after refresh',
      path: 'projection.currentTask.currentTurnRef',
      severity: 'error',
      expected: 'turn:fresh',
      actual: 'turn:follow-up',
      observedAt: '2026-05-16T00:00:02.000Z',
    },
    {
      contractId: 'sciforge.artifact-delivery.v1',
      message: 'diagnostic artifact reached primary view',
      severity: 'error',
    },
  ],
  contextDigest: 'sha256:context-a',
  projectionDigest: 'sha256:projection-a',
};

const report = createWebE2eFlakeFailureReport(failedAttempt, { cwd });
assert.equal(report.minimalReproCommand, "npm run smoke:web-multiturn-final -- --case SA-WEB-26 --no-retry --seed 'seed with spaces'");
assert.equal(report.caseManifest.path, 'docs/test-artifacts/web-e2e/SA-WEB-26/manifest.json');
assert.equal(report.caseManifest.digest, 'sha256:manifest');
assert.equal(report.lastScreenshot.id, 'failure');
assert.equal(report.lastScreenshot.path, 'docs/test-artifacts/web-e2e/SA-WEB-26/screenshots/failure.png');
assert.equal(report.firstFailedContract.contractId, 'sciforge.current-task.v1');
assert.match(formatWebE2eFlakePolicyReport(report), /minimal repro: npm run smoke:web-multiturn-final/);

assert.equal(
  buildWebE2eMinimalReproCommand({
    caseId: 'SA WEB 26',
    runnerCommand: 'tsx tests/smoke/smoke-web-multiturn-final.ts',
  }),
  "tsx tests/smoke/smoke-web-multiturn-final.ts --case 'SA WEB 26' --no-retry",
);

const cleanEvaluation = enforceWebE2eFlakePolicy([
  failedAttempt,
  {
    ...failedAttempt,
    attempt: 2,
    status: 'failed',
    contextDigest: 'sha256:context-a',
    projectionDigest: 'sha256:projection-a',
  },
], { cwd });
assert.equal(cleanEvaluation.reports.length, 2);
assert.equal(cleanEvaluation.driftViolations.length, 0);

assert.throws(
  () => createWebE2eFlakeFailureReport({
    ...failedAttempt,
    caseManifest: undefined,
  }, { cwd }),
  /case manifest path/,
);

assert.throws(
  () => createWebE2eFlakeFailureReport({
    ...failedAttempt,
    instrumentation: { ...failedAttempt.instrumentation!, evidence: [] },
    screenshots: [],
  }, { cwd }),
  /last screenshot/,
);

assert.throws(
  () => createWebE2eFlakeFailureReport({
    ...failedAttempt,
    contractFailures: [],
  }, { cwd }),
  /first failed contract/,
);

assert.throws(
  () => enforceWebE2eFlakePolicy([
    failedAttempt,
    {
      ...failedAttempt,
      attempt: 2,
      status: 'passed',
      contextDigest: 'sha256:context-b',
      projectionDigest: 'sha256:projection-a',
    },
  ], { cwd }),
  (error) => {
    assert.ok(error instanceof WebE2eFlakePolicyError);
    assert.match(error.message, /forbids retry from masking nondeterministic context drift/);
    assert.match(error.message, /SA-WEB-26 attempts 1->2: context sha256:context-a -> sha256:context-b/);
    assert.equal(error.evaluation.driftViolations.length, 1);
    return true;
  },
);

assert.throws(
  () => enforceWebE2eFlakePolicy([
    {
      ...failedAttempt,
      contextDigest: undefined,
    },
    {
      ...failedAttempt,
      attempt: 2,
      status: 'passed',
      contextDigest: undefined,
    },
  ], { cwd }),
  (error) => {
    assert.ok(error instanceof WebE2eFlakePolicyError);
    assert.match(error.message, /context <missing> -> <missing>/);
    return true;
  },
);

console.log('[ok] SA-WEB-26 flake policy emits repro evidence and blocks retry-masked context drift');
