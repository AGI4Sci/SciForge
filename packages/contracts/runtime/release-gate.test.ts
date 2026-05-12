import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_GATE_CONTRACT_ID,
  RELEASE_GATE_REQUIRED_COMMAND,
  buildReleaseGateAudit,
  releaseGateAllowsPush,
} from './release-gate';

test('release gate allows push only after full verify, service restart, summary, git target, and audit refs pass', () => {
  const audit = buildReleaseGateAudit({
    gateId: 'gate-ready',
    changeSummary: 'Added release verification guard and smoke coverage.',
    currentBranch: 'main',
    targetRemote: 'origin',
    targetBranch: 'main',
    auditRefs: ['file:.sciforge/audits/release-gate.json'],
    gitRefs: ['commit:abc123'],
    createdAt: '2026-05-13T00:00:00.000Z',
    steps: [{
      kind: 'release-verify',
      status: 'passed',
      command: RELEASE_GATE_REQUIRED_COMMAND,
      evidenceRefs: ['run:verify-full#2026-05-13'],
    }, {
      kind: 'service-restart',
      status: 'passed',
      evidenceRefs: ['service:workspace-writer', 'service:agentserver'],
    }],
  });

  assert.equal(audit.contract, RELEASE_GATE_CONTRACT_ID);
  assert.equal(audit.status, 'passed');
  assert.equal(audit.pushAllowed, true);
  assert.equal(releaseGateAllowsPush(audit), true);
  assert.deepEqual(audit.missing, []);
  assert.equal(audit.steps.some((step) => step.kind === 'audit-record' && step.status === 'passed'), true);
});

test('release gate blocks push when verify full evidence is missing', () => {
  const audit = buildReleaseGateAudit({
    changeSummary: 'Prepared a change summary without the full gate.',
    currentBranch: 'main',
    targetRemote: 'origin',
    auditRefs: ['file:.sciforge/audits/release-gate.json'],
    steps: [{
      kind: 'service-restart',
      status: 'passed',
      evidenceRefs: ['service:agentserver'],
    }],
  });

  assert.equal(audit.status, 'blocked');
  assert.equal(audit.pushAllowed, false);
  assert.equal(releaseGateAllowsPush(audit), false);
  assert.ok(audit.missing.includes(RELEASE_GATE_REQUIRED_COMMAND));
  assert.match(audit.nextActions[0] ?? '', /Do not push/);
});

test('release gate fails closed when full verify fails', () => {
  const audit = buildReleaseGateAudit({
    changeSummary: 'Release candidate.',
    currentBranch: 'main',
    targetRemote: 'origin',
    auditRefs: ['file:.sciforge/audits/release-gate.json'],
    steps: [{
      kind: 'release-verify',
      status: 'failed',
      command: RELEASE_GATE_REQUIRED_COMMAND,
      failureReason: 'typecheck failed',
      evidenceRefs: ['run:verify-full#failed'],
    }, {
      kind: 'service-restart',
      status: 'passed',
      evidenceRefs: ['service:agentserver'],
    }],
  });

  assert.equal(audit.status, 'failed');
  assert.equal(audit.pushAllowed, false);
  assert.deepEqual(audit.failureReasons, ['typecheck failed']);
  assert.match(audit.nextActions[0] ?? '', /Do not push/);
});
