import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedbackBundle,
  buildFeedbackGithubIssueBody,
  buildFeedbackGithubIssueTitle,
  importGithubOpenIssuesAsFeedback,
  mapGithubIssueRows,
  markFeedbackGithubIssueCreated,
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

  assert.equal(next.feedbackComments?.[0].status, 'planned');
  assert.equal(next.feedbackComments?.[0].githubIssueNumber, 7);
  assert.equal(next.feedbackRequests?.[0].status, 'in-progress');
  assert.equal(next.githubSyncedOpenIssues?.[0].number, 7);
});
