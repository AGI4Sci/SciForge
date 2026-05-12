import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackCommentRecord, FeedbackRepairResultRecord, FeedbackRepairRunRecord, SciForgeWorkspaceState } from '../domain';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackConvergenceFromComments,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  feedbackRepairAuditForIssue,
  replaceGithubSyncedOpenIssuesInWorkspace,
  upsertFeedbackRepairResultInWorkspace,
  upsertFeedbackRepairRunInWorkspace,
  updateFeedbackCommentStatus,
} from './feedbackWorkspace';

const baseComment: FeedbackCommentRecord = {
  id: 'feedback-1',
  schemaVersion: 1,
  authorId: 'local-user',
  authorName: 'Local User',
  comment: '通用反馈内容',
  status: 'open',
  priority: 'normal',
  tags: [],
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
  target: {
    selector: 'button.primary',
    path: 'main > button',
    text: '提交',
    tagName: 'button',
    rect: { x: 0, y: 0, width: 10, height: 10 },
  },
  viewport: { width: 1200, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  runtime: {
    page: 'workbench',
    url: 'http://localhost:5173/',
    scenarioId: 'scenario-any',
    sessionId: 'session-1',
  },
};

function comment(id: string, status: FeedbackCommentRecord['status'] = 'open'): FeedbackCommentRecord {
  return {
    ...baseComment,
    id,
    status,
    comment: `comment ${id}`,
  };
}

function workspace(comments: FeedbackCommentRecord[] = [comment('feedback-1')]): SciForgeWorkspaceState {
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/workspace',
    sessionsByScenario: {} as SciForgeWorkspaceState['sessionsByScenario'],
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: comments,
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

test('adds feedback comments without replacing existing comments', () => {
  const next = addFeedbackCommentToWorkspace(workspace([comment('old')]), comment('new'));

  assert.deepEqual(next.feedbackComments?.map((item) => item.id), ['new', 'old']);
});

test('updates selected feedback status only', () => {
  const next = updateFeedbackCommentStatus(
    workspace([comment('a'), comment('b')]),
    ['b'],
    'fixed',
    '2026-05-07T01:00:00.000Z',
  );

  assert.equal(next.feedbackComments?.[0].status, 'open');
  assert.equal(next.feedbackComments?.[1].status, 'fixed');
  assert.equal(next.feedbackComments?.[1].updatedAt, '2026-05-07T01:00:00.000Z');
});

test('deletes feedback and removes deleted ids from requests', () => {
  const state: SciForgeWorkspaceState = {
    ...workspace([comment('a'), comment('b')]),
    feedbackRequests: [{
      id: 'request-1',
      schemaVersion: 1,
      title: 'Request',
      status: 'draft',
      feedbackIds: ['a', 'b', 'missing'],
      summary: 'Summary',
      acceptanceCriteria: [],
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
    }],
  };

  const next = deleteFeedbackCommentsFromWorkspace(state, ['a']);

  assert.deepEqual(next.feedbackComments?.map((item) => item.id), ['b']);
  assert.deepEqual(next.feedbackRequests?.[0].feedbackIds, ['b', 'missing']);
});

test('creates requests from selected comments and triages open comments', () => {
  const next = createFeedbackRequestFromComments(
    workspace([comment('a'), comment('b', 'planned')]),
    ['a', 'b'],
    '通用请求',
    { requestId: 'request-new', createdAt: '2026-05-07T02:00:00.000Z' },
  );

  assert.equal(next.feedbackRequests?.[0].id, 'request-new');
  assert.deepEqual(next.feedbackRequests?.[0].acceptanceCriteria, ['comment a', 'comment b']);
  assert.equal(next.feedbackComments?.[0].status, 'triaged');
  assert.equal(next.feedbackComments?.[1].status, 'planned');
  assert.equal(next.feedbackComments?.[0].requestId, 'request-new');
});

test('creates user feedback convergence from workspace comments with runtime refs', () => {
  const comments: FeedbackCommentRecord[] = [{
    ...comment('slow-feedback'),
    comment: '太慢了，卡住没反应。',
    priority: 'high',
    runtime: {
      ...baseComment.runtime,
      sessionId: 'session-slow',
      activeRunId: 'run-slow',
      artifactSummary: [{ id: 'latency-diagnostic', type: 'runtime-diagnostic' }],
      executionSummary: [{ id: 'slow-eu', tool: 'agentserver', status: 'failed-with-reason' }],
    },
    screenshotRef: 'file:.sciforge/feedback/screenshots/slow.png',
  }, {
    ...comment('citation-feedback'),
    comment: '引用不对，来源错了。',
    tags: ['citation'],
    runtime: {
      ...baseComment.runtime,
      sessionId: 'session-cite',
      activeRunId: 'run-cite',
      artifactSummary: [{ id: 'report', type: 'research-report' }],
    },
  }];

  const convergence = createFeedbackConvergenceFromComments(comments, {
    createdAt: '2026-05-13T00:00:00.000Z',
  });

  assert.equal(convergence.contract, 'sciforge.user-feedback-convergence.v1');
  assert.deepEqual(new Set(convergence.signals.map((signal) => signal.kind)), new Set(['latency', 'citation-mismatch']));
  assert.ok(convergence.signals.find((signal) => signal.id === 'slow-feedback')?.refs.includes('artifact:latency-diagnostic'));
  assert.ok(convergence.signals.find((signal) => signal.id === 'slow-feedback')?.refs.includes('execution-unit:slow-eu'));
  assert.ok(convergence.todoCandidates.every((todo) => todo.noHardcodeReview.status === 'pass'));
});

test('replaces synced GitHub issue cache with explicit timestamp', () => {
  const next = replaceGithubSyncedOpenIssuesInWorkspace(workspace(), [{
    schemaVersion: 1,
    number: 7,
    title: 'Issue',
    body: 'Body',
    htmlUrl: 'https://github.com/org/repo/issues/7',
    updatedAt: '2026-05-07T01:00:00.000Z',
    labels: [],
    syncedAt: '2026-05-07T01:00:00.000Z',
  }], '2026-05-07T03:00:00.000Z');

  assert.equal(next.githubSyncedOpenIssues?.[0].number, 7);
  assert.equal(next.updatedAt, '2026-05-07T03:00:00.000Z');
});

test('maps repair run statuses into audit copy', () => {
  const statuses: Array<[FeedbackRepairRunRecord['status'], string]> = [
    ['assigned', '已交给实例'],
    ['analyzing', '分析中'],
    ['patching', '改代码中'],
    ['testing', '测试中'],
    ['needs-human-verification', '需人工核验'],
    ['blocked', '修复受阻'],
  ];

  for (const [status, label] of statuses) {
    const audit = feedbackRepairAuditForIssue('feedback-1', [repairRun(status)], []);
    assert.equal(audit.status, status);
    assert.equal(audit.label, label);
  }
});

test('renders fixed repair result with structured evidence and passing tests', () => {
  const result = repairResult({
    status: 'github-synced',
    verdict: 'fixed',
    executorInstance: { id: 'repair-peer', name: 'Repair Peer' },
    changedFiles: ['src/ui/src/app/SciForgeApp.tsx'],
    diffRef: 'diff://repair-1',
    commit: 'abc1234',
    refs: { commitSha: 'abc1234', commitUrl: 'https://github.com/org/repo/commit/abc1234', prUrl: 'https://github.com/org/repo/pull/9', patchRef: 'patch://repair-1' },
    tests: [{ command: 'npm test -- feedbackWorkspace', status: 'passed', outputRef: 'stdout://1' }],
    humanVerification: { status: 'not-required' },
    githubSyncStatus: 'synced',
    githubCommentUrl: 'https://github.com/org/repo/issues/7#issuecomment-1',
  });

  const audit = feedbackRepairAuditForIssue('feedback-1', [], [result]);

  assert.equal(audit.status, 'github-synced');
  assert.equal(audit.testsPassed, true);
  assert.equal(audit.githubSynced, true);
  assert.equal(audit.latestRunStatus, 'not-started');
  assert.equal(audit.latestResultVerdict, 'fixed');
  assert.equal(audit.githubSyncStatus, 'synced');
  assert.equal(audit.refs?.prUrl, 'https://github.com/org/repo/pull/9');
  assert.equal(audit.missingTestEvidence, false);
  assert.equal(audit.executorInstance, 'Repair Peer (repair-peer)');
  assert.deepEqual(audit.changedFiles, ['src/ui/src/app/SciForgeApp.tsx']);
  assert.equal(audit.headline, '测试通过，已同步 GitHub。');
});

test('flags fixed repair result that has no test evidence', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({ verdict: 'fixed', status: 'fixed', tests: [] })]);

  assert.equal(audit.status, 'needs-human-verification');
  assert.equal(audit.badge, 'warning');
  assert.equal(audit.missingTestEvidence, true);
  assert.match(audit.headline, /缺测试证据/);
});

test('blocks fixed repair result that has failed tests', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    verdict: 'fixed',
    status: 'github-synced',
    tests: [{ command: 'npm test', status: 'failed', summary: '1 failing test' }],
    githubCommentUrl: 'https://github.com/org/repo/issues/7#issuecomment-1',
  })]);

  assert.equal(audit.status, 'blocked');
  assert.equal(audit.badge, 'danger');
  assert.equal(audit.testsPassed, false);
  assert.match(audit.headline, /失败测试/);
});

test('surfaces assigned executor and active processing copy without requiring an embedded runner', () => {
  const assigned = feedbackRepairAuditForIssue('feedback-1', [repairRun('assigned')], []);
  const running = feedbackRepairAuditForIssue('feedback-1', [{ ...repairRun('assigned'), status: 'running' }], []);

  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.executorInstance, 'Repair Peer (repair-peer)');
  assert.match(assigned.headline, /已交给目标实例/);
  assert.equal(running.status, 'analyzing');
  assert.match(running.headline, /正在处理/);
});

test('marks human verification as explicit instead of ambiguous confirmation', () => {
  const audit = feedbackRepairAuditForIssue('feedback-1', [], [repairResult({
    verdict: 'needs-follow-up',
    humanVerification: { status: 'required', verifier: 'product-owner', conclusion: '视觉影响需要产品 owner 复核', evidenceRefs: ['workspace://screenshots/after.png'], verifiedAt: '2026-05-07T05:30:00.000Z' },
  })]);

  assert.equal(audit.status, 'needs-human-verification');
  assert.equal(audit.needsHumanVerification, true);
  assert.match(audit.headline, /需要人工核验/);
  assert.match(audit.humanVerification ?? '', /workspace:\/\/screenshots\/after\.png/);
  assert.doesNotMatch(audit.headline + audit.detail + (audit.humanVerification ?? ''), /需确认但不知道怎么确认/);
});

test('upserts feedback repair handoff records without duplicating ids', () => {
  const run = repairRun('assigned');
  const result = repairResult({ id: 'repair-result-1' });
  const withRun = upsertFeedbackRepairRunInWorkspace(workspace(), run);
  const withReplacedRun = upsertFeedbackRepairRunInWorkspace(withRun, { ...run, status: 'testing' });
  const withResult = upsertFeedbackRepairResultInWorkspace(withReplacedRun, result);
  const withReplacedResult = upsertFeedbackRepairResultInWorkspace(withResult, { ...result, summary: 'updated' });

  assert.equal(withReplacedResult.feedbackRepairRuns?.length, 1);
  assert.equal(withReplacedResult.feedbackRepairRuns?.[0].status, 'testing');
  assert.equal(withReplacedResult.feedbackRepairResults?.length, 1);
  assert.equal(withReplacedResult.feedbackRepairResults?.[0].summary, 'updated');
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
    verdict: 'fixed',
    summary: 'Fixed the feedback.',
    changedFiles: [],
    evidenceRefs: [],
    completedAt: '2026-05-07T05:00:00.000Z',
    ...overrides,
  };
}
