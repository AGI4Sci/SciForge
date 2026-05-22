import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PeerInstance } from '../domain';
import { FeedbackRepairAuditPanel, repairAuditRows, repairAuditStateMessages, repairSafeMode, repairTerminalMirror } from './FeedbackRepairAuditPanel';
import { feedbackRepairAuditForIssue } from './feedbackWorkspace';
import type { FeedbackRepairActionRecord, FeedbackRepairResultRecord, FeedbackRepairRunRecord } from '../domain';

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
  assert.match(html, /记录 browser 复核/);
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

test('repair audit panel allows a blocked handoff audit when no repair target exists', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [], []);
  const html = renderToStaticMarkup(
    <FeedbackRepairAuditPanel
      audit={audit}
      repairTargets={[]}
      targetValue=""
      onTargetChange={() => undefined}
      onHandoff={() => undefined}
    />,
  );

  assert.match(html, /无 repair 实例/);
  assert.match(html, /记录阻断/);
  assert.match(html, /没有 repair 实例时也会写入 blocked audit/);
  assert.doesNotMatch(html, /<button type="button" disabled="">[\s\S]*?记录阻断<\/button>/);
});

test('repair audit panel renders ordered terminal mirror lines and blocked stop control', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [
    repairRun('running', {
      terminalMirrorRef: '.sciforge/repair-results/run-1/terminal-mirror.ndjson',
      planRef: '.sciforge/repair-results/run-1/repair-request-plan.json',
      baseCommit: 'abc123',
      dirtyWorktreeDigest: 'dirty-digest',
      protectedFilesDigest: 'protected-digest',
      feedbackDataDigest: 'feedback-digest',
      confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
      terminalMirror: [
        { timestamp: '2026-05-07T04:00:02.000Z', stream: 'stdout', text: 'third line from run' },
        { timestamp: '2026-05-07T04:00:00.000Z', stream: 'event', text: 'first line from run' },
      ],
    }),
  ], [
    repairResult({
      terminalMirrorRef: '.sciforge/repair-results/run-1/terminal-mirror.ndjson',
      planRef: '.sciforge/repair-results/run-1/repair-request-plan.json',
      auditBundleRef: '.sciforge/repair-results/run-1/dirty-worktree-protection.json',
      metadata: {
        terminalMirror: [
          { timestamp: '2026-05-07T04:00:01.000Z', stream: 'stderr', text: 'second line from result metadata' },
        ],
        guardDigests: { dirtyWorktreeDigest: 'dirty-digest', protectedFilesDigest: 'protected-digest', feedbackDataDigest: 'feedback-digest' },
      },
    } as Partial<FeedbackRepairResultRecord>),
  ]);

  const html = renderToStaticMarkup(
    <FeedbackRepairAuditPanel
      audit={audit}
      repairTargets={[repairPeer]}
      targetValue="Repair Peer"
      onTargetChange={() => undefined}
      onHandoff={() => undefined}
      onStopRepair={async () => ({ stopped: true, status: 'cancel-requested', message: 'stop requested' })}
    />,
  );

  const first = html.indexOf('first line from run');
  const second = html.indexOf('second line from result metadata');
  const third = html.indexOf('third line from run');
  assert.ok(first > 0, 'first terminal line should render');
  assert.ok(second > first, 'result metadata line should be ordered after the first run line');
  assert.ok(third > second, 'later run line should render last');
  assert.match(html, /Terminal mirror/);
  assert.match(html, /复制/);
  assert.match(html, /导出 Bundle/);
  assert.match(html, /停止/);
  assert.match(html, /<button type="button" disabled="">[\s\S]*?停止<\/button>/);
  assert.match(html, /当前没有可安全停止的运行中 Runtime Codex repair turn/);
  assert.doesNotMatch(html, /请求 backend 安全取消当前 Runtime Codex repair turn/);
});

test('terminal mirror export payload preserves refs, copy state, and metadata', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [
    repairRun('running', {
      terminalMirrorRef: '.sciforge/repair-results/run-1/terminal-mirror.ndjson',
      planRef: '.sciforge/repair-results/run-1/repair-request-plan.json',
      confirmationPolicy: { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' },
      terminalMirror: [
        { timestamp: '2026-05-07T04:00:00.000Z', stream: 'event', text: 'accepted' },
      ],
      metadata: {
        guardDigests: { dirtyWorktreeDigest: 'dirty', protectedFilesDigest: 'protected', feedbackDataDigest: 'feedback' },
      },
    }),
  ], [
    repairResult({
      auditBundleRef: '.sciforge/repair-results/run-1/dirty-worktree-protection.json',
    }),
  ]);

  const terminal = repairTerminalMirror(audit);
  assert.equal(terminal.copyText, '[2026-05-07T04:00:00.000Z] event accepted');
  assert.equal(terminal.exportPayload.terminalMirrorRef, '.sciforge/repair-results/run-1/terminal-mirror.ndjson');
  assert.equal(terminal.exportPayload.planRef, '.sciforge/repair-results/run-1/repair-request-plan.json');
  assert.equal(terminal.exportPayload.auditBundleRef, '.sciforge/repair-results/run-1/dirty-worktree-protection.json');
  assert.equal(terminal.exportPayload.entryCount, 1);
  assert.equal(terminal.exportPayload.copyAvailable, true);
  assert.deepEqual(terminal.exportPayload.stopControl, {
    available: false,
    reason: 'repair result is already available; no active repair turn is available to stop',
  });
  assert.equal(terminal.exportPayload.repairBundle.terminalMirrorRef, '.sciforge/repair-results/run-1/terminal-mirror.ndjson');
  assert.equal(terminal.exportPayload.repairBundle.auditBundleRef, '.sciforge/repair-results/run-1/dirty-worktree-protection.json');
  assert.deepEqual(terminal.exportPayload.confirmationPolicy, { commit: 'requires-user-confirmation', push: 'requires-second-confirmation', pr: 'requires-second-confirmation', merge: 'never' });

  const activeTerminal = repairTerminalMirror(feedbackRepairAuditForIssue('feedback-1', [repairRun('running')], []));
  assert.deepEqual(activeTerminal.exportPayload.stopControl, {
    available: true,
    reason: 'safe stop endpoint may cancel only the active Runtime Codex turn',
  });
});

test('fixed repair with weak evidence stays partial and exports missing refs', () => {
  const weakResult = repairResult({
    refs: {},
    diffRef: undefined,
    planRef: undefined,
    terminalMirrorRef: undefined,
    auditBundleRef: undefined,
    evidenceRefs: [],
    tests: undefined,
    testResults: [{ command: 'npm test', status: 'passed', summary: 'claimed pass without output ref' }],
    metadata: {},
  });
  const audit = feedbackRepairAuditForIssue('feedback-1', [], [weakResult]);
  const html = renderToStaticMarkup(
    <FeedbackRepairAuditPanel
      audit={audit}
      repairTargets={[repairPeer]}
      targetValue="Repair Peer"
      onTargetChange={() => undefined}
      onHandoff={() => undefined}
    />,
  );
  const terminal = repairTerminalMirror(audit);

  assert.match(html, /Evidence completeness/);
  assert.match(html, /1\/6/);
  assert.match(html, /测试通过。/);
  assert.doesNotMatch(html, /已同步 GitHub。/);
  assert.equal(terminal.exportPayload.terminalMirrorRef, undefined);
  assert.equal(terminal.exportPayload.planRef, undefined);
  assert.equal(terminal.exportPayload.auditBundleRef, undefined);
  assert.equal(terminal.exportPayload.repairBundle.patchRef, undefined);
  assert.equal(terminal.exportPayload.repairBundle.diffRef, undefined);
  assert.deepEqual(terminal.exportPayload.repairBundle.testOutputRefs, []);
  assert.deepEqual(terminal.exportPayload.repairBundle.evidenceRefs, []);
});

test('repair action audit renders and exports confirmation history', () => {
  const action = repairAction({
    status: 'completed',
    sideEffect: 'local-commit',
    confirmedAt: '2026-05-07T06:01:00.000Z',
    safeModeConfirmed: true,
    message: 'Created local isolated-worktree commit abc123.',
  });
  const browserAction = repairAction({
    id: 'repair-action-browser',
    action: 'browser-recheck',
    status: 'completed',
    message: 'Browser recheck recorded as passed.',
    browserVerification: {
      status: 'passed',
      verifier: 'codex-in-app-browser',
      conclusion: 'Original issue no longer reproduces.',
      evidenceRefs: ['docs/test-artifacts/feedback-inbox-closure/browser-recheck.png'],
      verifiedAt: '2026-05-07T06:02:00.000Z',
    },
  });
  const audit = feedbackRepairAuditForIssue('feedback-1', [], [repairResult()], [action, browserAction]);
  const html = renderToStaticMarkup(
    <FeedbackRepairAuditPanel
      audit={audit}
      repairTargets={[repairPeer]}
      targetValue="Repair Peer"
      onTargetChange={() => undefined}
      onHandoff={() => undefined}
    />,
  );
  const terminal = repairTerminalMirror(audit);

  assert.match(html, /Action audit/);
  assert.match(html, /commit/);
  assert.match(html, /completed/);
  assert.match(html, /local-commit/);
  assert.match(html, /safe-mode confirmed/);
  assert.match(html, /Created local isolated-worktree commit abc123\./);
  assert.match(html, /browser-recheck/);
  assert.match(html, /browser evidence docs\/test-artifacts\/feedback-inbox-closure\/browser-recheck\.png/);
  assert.deepEqual(terminal.exportPayload.repairBundle.actionHistory, audit.actionHistory);
});

test('repair safe mode uses structured control-surface paths instead of broad feedback copy', () => {
  const active = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    changedFiles: ['src/runtime/workspace-server.ts'],
    summary: 'Backend action gate repaired.',
  })]);
  assert.equal(repairSafeMode(active).active, true);
  assert.deepEqual(repairSafeMode(active).matchedPaths, ['src/runtime/workspace-server.ts']);

  const inactive = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    changedFiles: ['src/ui/src/app/SciForgeApp.tsx'],
    summary: 'Feedback copy updated for a normal app panel.',
  })]);
  assert.equal(repairSafeMode(inactive).active, false);

  const metadataActive = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    changedFiles: ['docs/notes.md'],
    metadata: {
      safeMode: {
        active: true,
        matchedPaths: ['src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx'],
      },
    },
  })]);
  assert.equal(repairSafeMode(metadataActive).active, true);
  assert.deepEqual(repairSafeMode(metadataActive).matchedPaths, ['src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx']);
});

function repairRun(status: FeedbackRepairRunRecord['status'], overrides: Partial<FeedbackRepairRunRecord> = {}): FeedbackRepairRunRecord {
  return {
    schemaVersion: 1,
    id: 'repair-run-1',
    issueId: 'feedback-1',
    status,
    externalInstanceId: 'repair-peer',
    externalInstanceName: 'Repair Peer',
    startedAt: '2026-05-07T04:00:00.000Z',
    ...overrides,
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

function repairAction(overrides: Partial<FeedbackRepairActionRecord> = {}): FeedbackRepairActionRecord {
  return {
    schemaVersion: 1,
    id: 'repair-action-1',
    issueId: 'feedback-1',
    repairResultId: 'repair-result-1',
    action: 'commit',
    status: 'requires-user-confirmation',
    sideEffect: 'none',
    requestedAt: '2026-05-07T06:00:00.000Z',
    message: 'Local commit requires explicit user confirmation and was not executed.',
    ...overrides,
  };
}
