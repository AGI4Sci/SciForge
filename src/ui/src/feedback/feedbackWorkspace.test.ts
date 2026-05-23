import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackCommentRecord, FeedbackRepairActionRecord, FeedbackRepairResultRecord, FeedbackRepairRunRecord, SciForgeWorkspaceState } from '../domain';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackConvergenceFromComments,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  feedbackRepairAuditForIssue,
  replaceGithubSyncedOpenIssuesInWorkspace,
  restoreFeedbackCommentsInWorkspace,
  softDeleteFeedbackCommentsInWorkspace,
  upsertFeedbackRepairActionInWorkspace,
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

function comment(
  id: string,
  status: FeedbackCommentRecord['status'] = 'open',
  overrides: Partial<Omit<FeedbackCommentRecord, 'runtime' | 'target' | 'viewport'>>
    & {
      runtime?: Partial<FeedbackCommentRecord['runtime']>;
      target?: Partial<FeedbackCommentRecord['target']>;
      viewport?: Partial<FeedbackCommentRecord['viewport']>;
    } = {},
): FeedbackCommentRecord {
  return {
    ...baseComment,
    id,
    status,
    comment: `comment ${id}`,
    ...overrides,
    target: { ...baseComment.target, ...(overrides.target ?? {}) },
    viewport: { ...baseComment.viewport, ...(overrides.viewport ?? {}) },
    runtime: { ...baseComment.runtime, ...(overrides.runtime ?? {}) },
    tags: overrides.tags ?? baseComment.tags,
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

test('status updates do not resurrect soft-deleted feedback without restore', () => {
  const deleted = softDeleteFeedbackCommentsInWorkspace(
    workspace([comment('a', 'triaged'), comment('b')]),
    ['a'],
    '2026-05-07T01:10:00.000Z',
  );
  const marked = updateFeedbackCommentStatus(deleted, ['a', 'b'], 'fixed', '2026-05-07T01:11:00.000Z');
  const restored = restoreFeedbackCommentsInWorkspace(marked, ['a'], '2026-05-07T01:12:00.000Z');

  assert.equal(marked.feedbackComments?.find((item) => item.id === 'a')?.status, 'deleted');
  assert.equal(marked.feedbackComments?.find((item) => item.id === 'a')?.deletedAt, '2026-05-07T01:10:00.000Z');
  assert.equal(marked.feedbackComments?.find((item) => item.id === 'b')?.status, 'fixed');
  assert.equal(restored.feedbackComments?.find((item) => item.id === 'a')?.status, 'triaged');
});

test('soft deletes feedback without dropping request, audit, GitHub, or evidence refs', () => {
  const deletedAt = '2026-05-07T01:30:00.000Z';
  const feedback = comment('a', 'blocked', {
    screenshotRef: 'file:.sciforge/feedback/a/legacy.png',
    rawScreenshotRef: 'file:.sciforge/feedback/a/raw.png',
    annotatedScreenshotRef: 'file:.sciforge/feedback/a/annotated.png',
    evidenceBundleRef: 'file:.sciforge/feedback/a/bundle.json',
    githubIssueUrl: 'https://github.com/org/repo/issues/7',
    githubIssueNumber: 7,
  });
  const state: SciForgeWorkspaceState = {
    ...workspace([feedback, comment('b')]),
    feedbackRequests: [{
      id: 'request-1',
      schemaVersion: 1,
      title: 'Request',
      status: 'draft',
      feedbackIds: ['a', 'b', 'missing'],
      summary: 'Summary',
      acceptanceCriteria: [],
      evidenceRefs: ['file:.sciforge/feedback/a/raw.png'],
      githubIssueUrl: 'https://github.com/org/repo/issues/7',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
    }],
    feedbackRepairRuns: [repairRun('assigned')],
    feedbackRepairResults: [repairResult({
      issueId: 'a',
      evidenceRefs: ['audit:repair/a'],
      refs: { patchRef: 'patch://repair-a' },
    })],
  };

  const next = deleteFeedbackCommentsFromWorkspace(state, ['a'], deletedAt);
  const deleted = next.feedbackComments?.find((item) => item.id === 'a');
  const workspaceMetadata = deleted?.metadata?.feedbackWorkspace as Record<string, unknown> | undefined;

  assert.deepEqual(next.feedbackComments?.map((item) => item.id), ['a', 'b']);
  assert.equal(deleted?.status, 'deleted');
  assert.equal(deleted?.deletedAt, deletedAt);
  assert.equal(deleted?.githubIssueUrl, 'https://github.com/org/repo/issues/7');
  assert.equal(deleted?.rawScreenshotRef, 'file:.sciforge/feedback/a/raw.png');
  assert.deepEqual(next.feedbackRequests?.[0].feedbackIds, ['a', 'b', 'missing']);
  assert.deepEqual(next.feedbackRepairRuns, state.feedbackRepairRuns);
  assert.deepEqual(next.feedbackRepairResults, state.feedbackRepairResults);
  assert.equal(workspaceMetadata?.previousStatus, 'blocked');
  assert.ok((workspaceMetadata?.preservedEvidenceRefs as string[]).includes('file:.sciforge/feedback/a/raw.png'));
  assert.equal(workspaceMetadata?.preservedGithubIssueUrl, 'https://github.com/org/repo/issues/7');
});

test('restores soft-deleted feedback to its previous status and keeps refs', () => {
  const state = softDeleteFeedbackCommentsInWorkspace(workspace([
    comment('a', 'github-open', {
      screenshotRef: 'file:.sciforge/feedback/a/raw.png',
      githubIssueUrl: 'https://github.com/org/repo/issues/7',
      githubIssueNumber: 7,
    }),
  ]), ['a'], '2026-05-07T01:30:00.000Z');

  const next = restoreFeedbackCommentsInWorkspace(state, ['a'], '2026-05-07T02:00:00.000Z');
  const restored = next.feedbackComments?.[0];
  const workspaceMetadata = restored?.metadata?.feedbackWorkspace as Record<string, unknown> | undefined;

  assert.equal(restored?.status, 'github-open');
  assert.equal(restored?.deletedAt, undefined);
  assert.equal(restored?.restoredAt, '2026-05-07T02:00:00.000Z');
  assert.equal(restored?.githubIssueUrl, 'https://github.com/org/repo/issues/7');
  assert.equal(restored?.screenshotRef, 'file:.sciforge/feedback/a/raw.png');
  assert.equal(workspaceMetadata?.softDeleted, false);
  assert.equal(workspaceMetadata?.lastDeletedAt, '2026-05-07T01:30:00.000Z');
});

test('creates requests from selected comments with evidence, risks, and operation scope metadata', () => {
  const next = createFeedbackRequestFromComments(
    workspace([
      comment('a', 'open', {
        expectedBehavior: '点击提交后显示成功状态',
        actualBehavior: '点击后没有反应',
        rawScreenshotRef: 'file:.sciforge/feedback/a/raw.png',
        annotatedScreenshotRef: 'file:.sciforge/feedback/a/annotated.png',
        evidenceBundleRef: 'file:.sciforge/feedback/a/bundle.json',
        evidenceStatus: {
          status: 'partial',
          rawScreenshot: true,
          annotatedScreenshot: false,
          targetSnapshot: true,
          runtimeSnapshot: true,
          scrubbed: true,
          diagnostics: ['annotation failed'],
        },
        githubIssueUrl: 'https://github.com/org/repo/issues/7',
        githubIssueNumber: 7,
        repairPolicy: {
          defaultCommit: false,
          defaultPush: false,
          defaultMerge: false,
          requiresUserConfirmation: true,
          allowedOperations: ['edit src/ui/src/feedback/feedbackWorkspace.ts'],
          forbiddenOperations: ['touch provider credentials'],
        },
        target: {
          stableSelector: 'button[data-testid="submit"]',
          domPath: 'main > form > button',
          textSnippet: '提交',
          role: 'button',
          label: '提交按钮',
        },
        runtime: {
          activeRunId: 'run-a',
          artifactSummary: [{ id: 'report-a', type: 'research-report', title: 'Report A' }],
          executionSummary: [{ id: 'EU-a', tool: 'agentserver', status: 'failed-with-reason' }],
        },
      }),
      comment('b', 'planned', {
        expectedBehavior: '列表保留当前排序',
        runtime: { page: 'feedback-inbox', url: 'http://localhost:5173/feedback' },
      }),
      comment('c', 'deleted', { expectedBehavior: '这条已删除反馈不应进入 request' }),
    ]),
    ['a', 'b', 'c', 'missing'],
    '通用请求',
    { requestId: 'request-new', createdAt: '2026-05-07T02:00:00.000Z' },
  );
  const request = next.feedbackRequests?.[0];
  const metadata = request?.metadata as Record<string, unknown> | undefined;
  const operationScope = metadata?.operationScope as Record<string, unknown> | undefined;
  const preservationPolicy = metadata?.preservationPolicy as Record<string, unknown> | undefined;
  const selectedFeedback = metadata?.selectedFeedback as Array<Record<string, unknown>> | undefined;

  assert.equal(request?.id, 'request-new');
  assert.deepEqual(request?.feedbackIds, ['a', 'b']);
  assert.deepEqual(request?.acceptanceCriteria, ['a: 点击提交后显示成功状态', 'b: 列表保留当前排序']);
  assert.ok(request?.evidenceRefs?.includes('file:.sciforge/feedback/a/raw.png'));
  assert.ok(request?.evidenceRefs?.includes('file:.sciforge/feedback/a/annotated.png'));
  assert.ok(request?.evidenceRefs?.includes('file:.sciforge/feedback/a/bundle.json'));
  assert.ok(request?.evidenceRefs?.includes('https://github.com/org/repo/issues/7'));
  assert.ok(request?.evidenceRefs?.includes('artifact:report-a'));
  assert.ok(request?.evidenceRefs?.includes('execution-unit:EU-a'));
  assert.match(request?.expectedResult ?? '', /a: 点击提交后显示成功状态/);
  assert.match(request?.expectedResult ?? '', /b: 列表保留当前排序/);
  assert.ok(request?.risks?.some((risk) => /partial or missing evidence/.test(risk)));
  assert.ok(request?.risks?.some((risk) => /Linked GitHub issues/.test(risk)));
  assert.ok(request?.allowedOperations?.includes('edit src/ui/src/feedback/feedbackWorkspace.ts'));
  assert.ok(request?.forbiddenOperations?.includes('git reset --hard'));
  assert.ok(request?.forbiddenOperations?.includes('touch provider credentials'));
  assert.deepEqual(metadata?.selectedFeedbackIds, ['a', 'b']);
  assert.equal(selectedFeedback?.[0]?.id, 'a');
  assert.deepEqual(operationScope?.allowedOperations, request?.allowedOperations);
  assert.deepEqual(operationScope?.forbiddenOperations, request?.forbiddenOperations);
  assert.equal(preservationPolicy?.softDeleteOnly, true);
  assert.equal(preservationPolicy?.preserveGithubLinks, true);
  assert.equal(preservationPolicy?.preserveRepairAudit, true);
  assert.equal(next.feedbackComments?.[0].status, 'triaged');
  assert.equal(next.feedbackComments?.[1].status, 'planned');
  assert.equal(next.feedbackComments?.[0].requestId, 'request-new');
  assert.equal(next.feedbackComments?.[2].requestId, undefined);
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
    planRef: 'plan://repair-1',
    terminalMirrorRef: 'terminal://repair-1',
    auditBundleRef: 'audit://repair-1',
    commit: 'abc1234',
    refs: { commitSha: 'abc1234', commitUrl: 'https://github.com/org/repo/commit/abc1234', prUrl: 'https://github.com/org/repo/pull/9', patchRef: 'patch://repair-1' },
    tests: [{ command: 'npm test -- feedbackWorkspace', status: 'passed', outputRef: 'stdout://1' }],
    humanVerification: { status: 'not-required' },
    githubSyncStatus: 'synced',
    githubCommentUrl: 'https://github.com/org/repo/issues/7#issuecomment-1',
    metadata: { guardDigests: { dirtyWorktreeDigest: 'dirty', protectedFilesDigest: 'protected', feedbackDataDigest: 'feedback' } },
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

test('keeps multiple repair attempts available as thread history', () => {
  const firstRun = repairRun('blocked');
  const secondRun = { ...repairRun('assigned'), id: 'repair-run-2', status: 'running' as const, startedAt: '2026-05-07T06:00:00.000Z' };
  const firstResult = repairResult({
    repairRunId: firstRun.id,
    verdict: 'failed',
    status: 'blocked',
    summary: 'First repair attempt blocked.',
    completedAt: '2026-05-07T05:30:00.000Z',
  });
  const audit = feedbackRepairAuditForIssue('feedback-1', [firstRun, secondRun], [firstResult]);

  assert.equal(audit.status, 'analyzing');
  assert.equal(audit.latestRun?.id, 'repair-run-2');
  assert.equal(audit.latestResultVerdict, undefined);
  assert.equal(audit.repairThreads.length, 2);
  assert.equal(audit.repairThreads[0].id, 'repair-run-2');
  assert.equal(audit.repairThreads[0].status, 'running');
  assert.equal(audit.repairThreads[1].resultVerdict, 'failed');
  assert.equal(audit.repairThreads[1].resultSummary, 'First repair attempt blocked.');
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
  const browserAction: FeedbackRepairActionRecord = {
    schemaVersion: 1,
    id: 'repair-action-browser',
    issueId: 'feedback-1',
    repairResultId: 'repair-result-1',
    action: 'browser-recheck',
    status: 'completed',
    sideEffect: 'none',
    requestedAt: '2026-05-07T06:02:00.000Z',
    confirmedAt: '2026-05-07T06:02:10.000Z',
    browserVerification: {
      status: 'passed',
      verifier: 'codex-in-app-browser',
      conclusion: 'Original issue no longer reproduces.',
      evidenceRefs: ['browser-recheck.png'],
      verifiedAt: '2026-05-07T06:02:10.000Z',
    },
    message: 'Browser recheck recorded as passed.',
  };
  const action: FeedbackRepairActionRecord = {
    schemaVersion: 1,
    id: 'repair-action-1',
    issueId: 'feedback-1',
    repairResultId: 'repair-result-1',
    action: 'commit',
    status: 'completed',
    sideEffect: 'local-commit',
    requestedAt: '2026-05-07T06:00:00.000Z',
    confirmedAt: '2026-05-07T06:01:00.000Z',
    message: 'Created local isolated-worktree commit abc123.',
  };
  const withAction = upsertFeedbackRepairActionInWorkspace(withReplacedResult, action);
  const withBrowserAction = upsertFeedbackRepairActionInWorkspace(withAction, browserAction);
  const withReplacedAction = upsertFeedbackRepairActionInWorkspace(withBrowserAction, { ...action, message: 'updated action audit' });

  assert.equal(withReplacedAction.feedbackRepairRuns?.length, 1);
  assert.equal(withReplacedAction.feedbackRepairRuns?.[0].status, 'testing');
  assert.equal(withReplacedAction.feedbackRepairResults?.length, 1);
  assert.equal(withReplacedAction.feedbackRepairResults?.[0].summary, 'updated');
  assert.equal(withReplacedAction.feedbackRepairActions?.length, 2);
  assert.equal(withReplacedAction.feedbackRepairActions?.[0].message, 'updated action audit');

  const audit = feedbackRepairAuditForIssue(
    'feedback-1',
    withReplacedAction.feedbackRepairRuns,
    withReplacedAction.feedbackRepairResults,
    withReplacedAction.feedbackRepairActions,
  );
  assert.equal(audit.actionHistory.length, 2);
  assert.ok(audit.actionHistory.some((item) => item.message === 'updated action audit' && item.sideEffect === 'local-commit'));
  assert.equal(audit.latestBrowserVerification?.status, 'passed');
  assert.match(audit.latestBrowserVerificationLabel ?? '', /browser-recheck\.png/);
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
