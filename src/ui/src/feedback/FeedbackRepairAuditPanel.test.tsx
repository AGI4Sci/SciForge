import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PeerInstance } from '../domain';
import { FeedbackRepairAuditPanel, repairAuditRows, repairAuditStateMessages } from './FeedbackRepairAuditPanel';
import { feedbackRepairAuditForIssue } from './feedbackWorkspace';
import type { FeedbackRepairResultRecord, FeedbackRepairRunRecord } from '../domain';

const repairPeer: PeerInstance = {
  name: 'Repair Peer',
  appUrl: 'http://127.0.0.1:5273',
  workspaceWriterUrl: 'http://127.0.0.1:5274',
  workspacePath: '/tmp/repair',
  role: 'repair',
  trustLevel: 'repair',
  enabled: true,
};

test('repair audit panel renders handoff controls and full audit fields', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [repairRun('assigned')], [repairResult()]);
  const html = renderToStaticMarkup(
    <FeedbackRepairAuditPanel
      audit={audit}
      repairTargets={[repairPeer]}
      targetValue="Repair Peer"
      hint="已交给 Repair Peer；等待外部实例写回 repair result。"
      onTargetChange={() => undefined}
      onHandoff={() => undefined}
    />,
  );

  assert.match(html, /repair audit panel/);
  assert.match(html, /交给实例\.\.\./);
  assert.match(html, /Repair Peer/);
  assert.match(html, /latestRunStatus/);
  assert.match(html, /latestResultVerdict/);
  assert.match(html, /changedFiles/);
  assert.match(html, /testResults/);
  assert.match(html, /humanVerification/);
  assert.match(html, /githubSyncStatus/);
  assert.match(html, /githubCommentUrl/);
  assert.doesNotMatch(html, /Repair Agent|需确认但不知道怎么确认/);
});

test('repair audit rows and state messages use explicit UX copy', () => {
  const assigned = feedbackRepairAuditForIssue('feedback-1', [repairRun('assigned')], []);
  const missingTests = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({ tests: [], testResults: [] })]);
  const failedTests = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    tests: [{ command: 'npm test', status: 'failed', summary: '1 failed' }],
  })]);
  const human = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    verdict: 'needs-follow-up',
    status: 'needs-human-verification',
    humanVerification: { status: 'required', verifier: 'QA', conclusion: 'manual visual pass needed', evidenceRefs: ['workspace://screenshots/final.png'], verifiedAt: '2026-05-07T05:30:00.000Z' },
  })]);

  assert.deepEqual(repairAuditStateMessages(assigned), ['已交给 Repair Peer (repair-peer)。']);
  assert.equal(missingTests.status, 'needs-human-verification');
  assert.ok(repairAuditRows(missingTests).some((row) => row.label === 'testResults' && row.value === 'missing'));
  assert.equal(failedTests.status, 'blocked');
  assert.match(missingTests.headline, /缺测试证据，不能认定已修复/);
  assert.match(human.headline, /需要人工核验/);
  assert.match(human.humanVerification ?? '', /workspace:\/\/screenshots\/final\.png/);
});

function repairRun(status: FeedbackRepairRunRecord['status']): FeedbackRepairRunRecord {
  return {
    schemaVersion: 1,
    id: 'repair-run-1',
    issueId: 'feedback-1',
    status,
    externalInstanceId: 'repair-peer',
    externalInstanceName: 'Repair Peer',
    startedAt: '2026-05-07T04:00:00.000Z',
  };
}

function repairResult(overrides: Partial<FeedbackRepairResultRecord> = {}): FeedbackRepairResultRecord {
  return {
    schemaVersion: 1,
    id: 'repair-result-1',
    issueId: 'feedback-1',
    repairRunId: 'repair-run-1',
    status: 'github-synced',
    verdict: 'fixed',
    summary: 'Legend overlap repaired.',
    executorInstance: { id: 'repair-peer', name: 'Repair Peer' },
    changedFiles: ['src/ui/src/app/SciForgeApp.tsx'],
    refs: {
      commitSha: 'abc1234',
      commitUrl: 'https://github.com/org/repo/commit/abc1234',
      prUrl: 'https://github.com/org/repo/pull/9',
      patchRef: 'patch://repair-1',
    },
    tests: [{ command: 'npm test -- FeedbackRepairAuditPanel', status: 'passed', summary: 'focused panel copy passed' }],
    humanVerification: { status: 'not-required' },
    githubSyncStatus: 'synced',
    githubCommentUrl: 'https://github.com/org/repo/issues/7#issuecomment-1',
    evidenceRefs: [],
    completedAt: '2026-05-07T05:00:00.000Z',
    ...overrides,
  };
}
