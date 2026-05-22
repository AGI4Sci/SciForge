import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedbackBundle,
  buildFeedbackGithubIssueBody,
  buildFeedbackGithubIssueTitle,
  importGithubOpenIssuesAsFeedback,
  mapGithubIssueRows,
  markFeedbackGithubIssueCreated,
  markFeedbackGithubIssueSyncFailed,
  markFeedbackGithubIssueSyncPending,
  submitFeedbackGithubIssue,
} from './githubFeedback';
import type { FeedbackCommentRecord, SciForgeWorkspaceState } from '../domain';

const feedback: FeedbackCommentRecord = {
  id: 'feedback-1',
  schemaVersion: 1,
  authorId: 'local-user',
  authorName: 'Local User',
  comment: '按钮需要把反馈同步到 GitHub。',
  status: 'open',
  priority: 'normal',
  tags: ['github'],
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
  target: {
    selector: 'button.submit',
    path: 'main > button',
    text: '提交到 GitHub',
    tagName: 'button',
    rect: { x: 1, y: 2, width: 3, height: 4 },
  },
  viewport: { width: 1200, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  runtime: {
    page: 'feedback',
    url: 'http://localhost:5173/',
    scenarioId: 'scenario-any',
    sessionId: 'session-1',
  },
};

const workspace: SciForgeWorkspaceState = {
  schemaVersion: 2,
  workspacePath: '/tmp/workspace',
  sessionsByScenario: {} as SciForgeWorkspaceState['sessionsByScenario'],
  archivedSessions: [],
  alignmentContracts: [],
  feedbackComments: [feedback],
  feedbackRequests: [{
    id: 'request-1',
    schemaVersion: 1,
    title: 'GitHub sync',
    status: 'draft',
    feedbackIds: ['feedback-1'],
    summary: 'Sync feedback.',
    acceptanceCriteria: ['Create issue'],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  }],
  githubSyncedOpenIssues: [],
  updatedAt: '2026-05-07T00:00:00.000Z',
};

test('formats feedback as a GitHub issue without page state dependencies', () => {
  const title = buildFeedbackGithubIssueTitle([feedback]);
  const body = buildFeedbackGithubIssueBody([feedback], workspace.feedbackRequests ?? [], 'test-build');
  const bundle = buildFeedbackBundle([feedback], workspace.feedbackRequests ?? [], 'test-build', '2026-05-07T01:00:00.000Z');

  assert.match(title, /^\[SciForge\]/);
  assert.match(body, /DOM selector/);
  assert.match(body, /button\.submit/);
  assert.equal(bundle.requests.length, 1);
});

test('formats screenshot evidence for GitHub using refs instead of inline data URLs', () => {
  const withScreenshot: FeedbackCommentRecord = {
    ...feedback,
    screenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
    rawScreenshotRef: 'feedback-bundle:feedback-1/screenshots/raw.png',
    annotatedScreenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
    evidenceBundleRef: 'feedback-bundle:feedback-1',
    evidenceAssets: [{
      schemaVersion: 1,
      id: 'asset-scrubbed-annotated',
      kind: 'scrubbed-annotated-screenshot',
      label: 'Scrubbed annotated screenshot',
      ref: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
      markdownImageUrl: 'repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
      githubMarkdownUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
      publicUrl: 'https://raw.githubusercontent.com/org/repo/main/repair-evidence/public/feedback-screenshots/feedback-1/scrubbed-annotated.png',
      uploadStatus: 'uploaded',
      mediaType: 'image/png',
      width: 640,
      height: 360,
      bytes: 1234,
      sha256: 'abc',
      createdAt: '2026-05-07T00:00:00.000Z',
      includeForAgent: false,
    }],
    screenshot: {
      schemaVersion: 1,
      dataUrl: 'data:image/png;base64,abc123',
      rawDataUrl: 'data:image/png;base64,raw123',
      annotatedDataUrl: 'data:image/png;base64,annotated123',
      mediaType: 'image/png',
      width: 640,
      height: 360,
      capturedAt: '2026-05-07T00:00:00.000Z',
      targetRect: { x: 1, y: 2, width: 3, height: 4 },
      includeForAgent: false,
    },
  };
  const body = buildFeedbackGithubIssueBody([withScreenshot], [], 'test-build');

  assert.match(body, /截图证据/);
  assert.match(body, /feedback-bundle:feedback-1\/screenshots\/annotated\.png/);
  assert.match(body, /!\[Scrubbed annotated screenshot\]\(https:\/\/raw\.githubusercontent\.com\/org\/repo\/main\/repair-evidence\/public\/feedback-screenshots\/feedback-1\/scrubbed-annotated\.png\)/);
  assert.match(body, /Inline screenshot dataUrl intentionally omitted from GitHub/);
  assert.doesNotMatch(body, /<img src=/);
  assert.doesNotMatch(body, /data:image\/png;base64,(abc123|raw123|annotated123)/);
});

test('omits oversized screenshot data from GitHub markdown and bundle JSON', () => {
  const withLargeScreenshot: FeedbackCommentRecord = {
    ...feedback,
    screenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
    rawScreenshotRef: 'feedback-bundle:feedback-1/screenshots/raw.png',
    annotatedScreenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
    evidenceBundleRef: 'feedback-bundle:feedback-1',
    screenshot: {
      schemaVersion: 1,
      dataUrl: `data:image/png;base64,${'a'.repeat(49_000)}`,
      rawDataUrl: `data:image/png;base64,${'b'.repeat(49_000)}`,
      annotatedDataUrl: `data:image/png;base64,${'c'.repeat(49_000)}`,
      mediaType: 'image/png',
      width: 640,
      height: 360,
      capturedAt: '2026-05-07T00:00:00.000Z',
      targetRect: { x: 1, y: 2, width: 3, height: 4 },
      includeForAgent: false,
    },
  };
  const body = buildFeedbackGithubIssueBody([withLargeScreenshot], [], 'test-build');

  assert.match(body, /Inline screenshot dataUrl intentionally omitted from GitHub/);
  assert.doesNotMatch(body, /<img src=/);
  assert.doesNotMatch(body, /data:image\/jpeg;base64/);
  assert.ok(body.length < 65_536);
});

test('maps open GitHub issues into local feedback records generically', () => {
  const issues = mapGithubIssueRows([{
    number: 42,
    title: 'Generic feedback issue',
    body: 'Imported from GitHub.',
    html_url: 'https://github.com/org/repo/issues/42',
    updated_at: '2026-05-07T02:00:00.000Z',
    user: { login: 'alice' },
    labels: [{ name: 'high' }],
  }], '2026-05-07T03:00:00.000Z');

  const result = importGithubOpenIssuesAsFeedback(workspace, issues, '2026-05-07T04:00:00.000Z', 'test-build');
  const imported = result.state.feedbackComments?.find((comment) => comment.githubIssueNumber === 42);

  assert.equal(result.changed, 1);
  assert.equal(imported?.runtime.scenarioId, 'github-feedback');
  assert.equal(imported?.priority, 'high');
  assert.equal(imported?.githubIssueUrl, 'https://github.com/org/repo/issues/42');
});

test('marks submitted feedback and linked requests with GitHub issue metadata', () => {
  const next = markFeedbackGithubIssueCreated(workspace, ['feedback-1'], {
    number: 7,
    title: '[SciForge] GitHub sync',
    htmlUrl: 'https://github.com/org/repo/issues/7',
  }, '2026-05-07T05:00:00.000Z');

  assert.equal(next.feedbackComments?.[0].status, 'github-open');
  assert.equal(next.feedbackComments?.[0].githubSyncStatus, 'github-open');
  assert.equal(next.feedbackComments?.[0].githubIssueNumber, 7);
  assert.equal(next.feedbackRequests?.[0].status, 'in-progress');
  assert.equal(next.githubSyncedOpenIssues?.[0].number, 7);
});

test('marks triaged submitted feedback as GitHub open after real issue creation', () => {
  const triaged: SciForgeWorkspaceState = {
    ...workspace,
    feedbackComments: [{ ...feedback, status: 'triaged' }],
  };
  const next = markFeedbackGithubIssueCreated(triaged, ['feedback-1'], {
    number: 8,
    title: '[SciForge] GitHub sync',
    htmlUrl: 'https://github.com/org/repo/issues/8',
  }, '2026-05-07T05:00:00.000Z');

  assert.equal(next.feedbackComments?.[0].status, 'github-open');
  assert.equal(next.feedbackComments?.[0].githubSyncStatus, 'github-open');
  assert.equal(next.feedbackComments?.[0].githubIssueNumber, 8);
});

test('round-trips a just-created GitHub issue through pull sync without duplicate or false conflict', () => {
  const pending = markFeedbackGithubIssueSyncPending(workspace, ['feedback-1'], '2026-05-07T05:00:00.000Z');
  const created = markFeedbackGithubIssueCreated(pending, ['feedback-1'], {
    number: 7,
    title: '[SciForge] GitHub sync',
    htmlUrl: 'https://github.com/org/repo/issues/7',
    labels: ['feedback'],
  }, '2026-05-07T05:00:03.000Z');
  const body = buildFeedbackGithubIssueBody([feedback], workspace.feedbackRequests ?? [], 'test-build');
  const issues = mapGithubIssueRows([{
    number: 7,
    title: '[SciForge] GitHub sync',
    body,
    html_url: 'https://github.com/org/repo/issues/7',
    state: 'open',
    updated_at: '2026-05-07T05:00:02.000Z',
    user: { login: 'alice' },
    labels: [{ name: 'feedback' }],
  }], '2026-05-07T05:00:04.000Z');

  const result = importGithubOpenIssuesAsFeedback(created, issues, '2026-05-07T05:00:05.000Z', 'test-build');
  const comments = result.state.feedbackComments ?? [];

  assert.equal(comments.filter((comment) => comment.id === 'feedback-1').length, 1);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].status, 'github-open');
  assert.equal(comments[0].githubSyncStatus, 'github-open');
  assert.equal(comments[0].comment, feedback.comment);
  assert.equal(result.state.githubSyncedOpenIssues?.[0].conflict?.status, 'none');
});

test('marks GitHub submit pending and failure without leaking secrets or local paths', () => {
  const pending = markFeedbackGithubIssueSyncPending(workspace, ['feedback-1'], '2026-05-07T05:30:00.000Z');
  assert.equal(pending.feedbackComments?.[0].githubSyncStatus, 'pending');
  assert.equal(pending.feedbackComments?.[0].githubSyncError, undefined);

  const failed = markFeedbackGithubIssueSyncFailed(
    pending,
    ['feedback-1'],
    new Error('bad token=sk-secretvalue1234567890 at /Users/alice/project/config.local.json'),
    '2026-05-07T05:31:00.000Z',
  );

  assert.equal(failed.feedbackComments?.[0].githubSyncStatus, 'failed');
  assert.doesNotMatch(failed.feedbackComments?.[0].githubSyncError ?? '', /sk-secret|\/Users\/alice/);
  assert.match(failed.feedbackComments?.[0].githubSyncError ?? '', /\[redacted-feedback-secret\]|\[redacted-feedback-path\]/);
});

test('imports newer divergent GitHub bodies as visible conflicts without overwriting local feedback', () => {
  const state: SciForgeWorkspaceState = {
    ...workspace,
    feedbackComments: [{
      ...feedback,
      githubIssueNumber: 42,
      updatedAt: '2026-05-07T02:00:00.000Z',
    }],
  };
  const issues = mapGithubIssueRows([{
    number: 42,
    title: 'Generic feedback issue',
    body: '<!-- sciforge-feedback-ids: feedback-1 -->\nRemote issue body changed independently.',
    html_url: 'https://github.com/org/repo/issues/42',
    updated_at: '2026-05-07T03:00:00.000Z',
    user: { login: 'alice' },
    labels: [{ name: 'feedback' }],
  }], '2026-05-07T04:00:00.000Z');

  const result = importGithubOpenIssuesAsFeedback(state, issues, '2026-05-07T05:00:00.000Z', 'test-build');

  assert.equal(result.state.feedbackComments?.[0].comment, feedback.comment);
  assert.equal(result.state.feedbackComments?.[0].githubSyncStatus, 'conflict');
  assert.equal(result.state.githubSyncedOpenIssues?.[0].conflict?.status, 'remote-edited-after-local');
});

test('submitFeedbackGithubIssue dry-run returns a draft URL without GitHub API calls', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('dry-run should not call fetch');
  }) as typeof fetch;
  try {
    const result = await submitFeedbackGithubIssue({
      repo: ' org/repo ',
      title: ' Dry run title ',
      body: ' Body with spaces ',
      labels: ['feedback'],
      assignees: ['alice'],
      milestone: 4,
      dryRun: true,
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.number, 0);
    assert.equal('dryRun' in result, true);
    if (!('dryRun' in result)) assert.fail('expected dry-run response');
    assert.equal(result.dryRun, true);
    assert.match(result.htmlUrl, /^https:\/\/github\.com\/org\/repo\/issues\/new\?/);
    assert.match(result.htmlUrl, /title=Dry%20run%20title/);
    assert.match(result.htmlUrl, /body=Body%20with%20spaces/);
    assert.deepEqual(result.diagnostics, ['Dry run enabled: no GitHub issue was created and local feedback should remain pending.']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('submitFeedbackGithubIssue propagates labels, assignees, and milestone to created issue payload', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === 'https://api.github.com/repos/org/repo' && !init?.method) {
      return new Response(JSON.stringify({ full_name: 'org/repo', private: false }), { status: 200 });
    }
    if (url === 'https://api.github.com/repos/org/repo/issues' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { title?: string };
      if (body.title === '') {
        return new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 });
      }
      return new Response(JSON.stringify({
        html_url: 'https://github.com/org/repo/issues/11',
        number: 11,
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 404 });
  }) as typeof fetch;
  try {
    const result = await submitFeedbackGithubIssue({
      repo: 'org/repo',
      token: ' github_pat_test ',
      title: ' GitHub sync ',
      body: ' Create issue ',
      labels: [' feedback ', 'bug', 'feedback', ''],
      assignees: [' alice ', 'bob', 'alice', ''],
      milestone: ' 12 ',
    });

    assert.deepEqual(result, {
      htmlUrl: 'https://github.com/org/repo/issues/11',
      number: 11,
    });
    assert.equal(calls.length, 3);
    const createCall = calls[2];
    assert.equal(createCall.url, 'https://api.github.com/repos/org/repo/issues');
    assert.deepEqual(JSON.parse(String(createCall.init.body)), {
      title: 'GitHub sync',
      body: 'Create issue',
      labels: ['bug', 'feedback'],
      assignees: ['alice', 'bob'],
      milestone: 12,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
