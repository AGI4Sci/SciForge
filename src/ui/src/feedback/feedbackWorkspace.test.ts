import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackCommentRecord, SciForgeWorkspaceState } from '../domain';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  replaceGithubSyncedOpenIssuesInWorkspace,
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
