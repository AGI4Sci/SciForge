import {
  makeId,
  nowIso,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type GithubSyncedOpenIssueRecord,
  type SciForgeWorkspaceState,
} from '../domain';

const FEEDBACK_COMMENT_LIMIT = 500;
const FEEDBACK_REQUEST_LIMIT = 80;

type FeedbackRequestRecord = NonNullable<SciForgeWorkspaceState['feedbackRequests']>[number];

export function addFeedbackCommentToWorkspace(
  state: SciForgeWorkspaceState,
  comment: FeedbackCommentRecord,
  limit = FEEDBACK_COMMENT_LIMIT,
): SciForgeWorkspaceState {
  return {
    ...state,
    feedbackComments: [comment, ...(state.feedbackComments ?? [])].slice(0, limit),
  };
}

export function updateFeedbackCommentStatus(
  state: SciForgeWorkspaceState,
  ids: string[],
  status: FeedbackCommentStatus,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? { ...comment, status, updatedAt }
      : comment),
  };
}

export function deleteFeedbackCommentsFromWorkspace(
  state: SciForgeWorkspaceState,
  ids: string[],
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).filter((comment) => !selected.has(comment.id)),
    feedbackRequests: (state.feedbackRequests ?? []).map((request) => ({
      ...request,
      feedbackIds: request.feedbackIds.filter((id) => !selected.has(id)),
    })),
  };
}

export function createFeedbackRequestFromComments(
  state: SciForgeWorkspaceState,
  ids: string[],
  title: string,
  options: {
    requestId?: string;
    createdAt?: string;
    requestLimit?: number;
  } = {},
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const createdAt = options.createdAt ?? nowIso();
  const requestId = options.requestId ?? makeId('request');
  const request = buildFeedbackRequest(state.feedbackComments ?? [], ids, title, requestId, createdAt);
  return {
    ...state,
    feedbackRequests: [request, ...(state.feedbackRequests ?? [])].slice(0, options.requestLimit ?? FEEDBACK_REQUEST_LIMIT),
    feedbackComments: (state.feedbackComments ?? []).map((comment) => ids.includes(comment.id)
      ? { ...comment, status: comment.status === 'open' ? 'triaged' : comment.status, requestId, updatedAt: createdAt }
      : comment),
  };
}

export function replaceGithubSyncedOpenIssuesInWorkspace(
  state: SciForgeWorkspaceState,
  issues: GithubSyncedOpenIssueRecord[],
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  return {
    ...state,
    githubSyncedOpenIssues: issues,
    updatedAt,
  };
}

function buildFeedbackRequest(
  comments: FeedbackCommentRecord[],
  ids: string[],
  title: string,
  requestId: string,
  createdAt: string,
): FeedbackRequestRecord {
  return {
    id: requestId,
    schemaVersion: 1,
    title,
    status: 'draft',
    feedbackIds: ids,
    summary: `Codex change request from ${ids.length} feedback comments.`,
    acceptanceCriteria: ids.map((id) => {
      const comment = comments.find((item) => item.id === id);
      return comment ? comment.comment : id;
    }).slice(0, 12),
    createdAt,
    updatedAt: createdAt,
  };
}
