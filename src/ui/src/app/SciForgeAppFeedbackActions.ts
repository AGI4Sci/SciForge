import { referenceComposerMarker } from '../../../../packages/support/object-references';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  replaceGithubSyncedOpenIssuesInWorkspace,
  restoreFeedbackCommentsInWorkspace,
  upsertFeedbackRepairActionInWorkspace,
  upsertFeedbackRepairGuidanceInWorkspace,
  upsertFeedbackRepairResultInWorkspace,
  upsertFeedbackRepairRunInWorkspace,
  updateFeedbackCommentText,
  updateFeedbackCommentStatus,
} from '../feedback/feedbackWorkspace';
import {
  importGithubOpenIssuesAsFeedback as applyGithubOpenIssuesAsFeedback,
  markFeedbackGithubIssueClosed,
  markFeedbackGithubIssueCreated,
  markFeedbackGithubIssueSyncFailed,
  markFeedbackGithubIssueSyncPending,
} from '../feedback/githubFeedback';
import { saveFeedbackCommentEvidenceBundle } from '../api/workspaceClient';
import {
  nowIso,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairActionRecord,
  type FeedbackRepairGuidanceRecord,
  type FeedbackRepairResultRecord,
  type FeedbackRepairRunRecord,
  type GithubSyncedOpenIssueRecord,
  type SciForgeConfig,
  type SciForgeWorkspaceState,
} from '../domain';
import { APP_BUILD_ID } from './appShell/appHelpers';

type WorkspaceUpdater = (mutator: (state: SciForgeWorkspaceState) => SciForgeWorkspaceState) => void;

type SciForgeFeedbackActionsInput = {
  config: SciForgeConfig;
  workspaceState: SciForgeWorkspaceState;
  updateWorkspace: WorkspaceUpdater;
  setWorkspaceStatus: (status: string) => void;
};

export function createSciForgeFeedbackActions({
  config,
  workspaceState,
  updateWorkspace,
  setWorkspaceStatus,
}: SciForgeFeedbackActionsInput) {
  function addFeedbackComment(comment: FeedbackCommentRecord) {
    updateWorkspace((current) => addFeedbackCommentToWorkspace(current, comment));
    saveFeedbackCommentEvidenceBundle(config, comment)
      .then((bundle) => {
        updateWorkspace((current) => ({
          ...current,
          feedbackComments: (current.feedbackComments ?? []).map((item) => item.id === comment.id
            ? {
              ...item,
              evidenceBundleRef: bundle.evidenceBundleRef || item.evidenceBundleRef,
              rawScreenshotRef: bundle.rawScreenshotRef || item.rawScreenshotRef,
              annotatedScreenshotRef: bundle.annotatedScreenshotRef || item.annotatedScreenshotRef,
              evidenceAssets: bundle.evidenceAssets?.length ? bundle.evidenceAssets : item.evidenceAssets,
              screenshot: item.screenshot
                ? {
                  ...item.screenshot,
                  rawScreenshotRef: bundle.rawScreenshotRef || item.screenshot.rawScreenshotRef,
                  annotatedScreenshotRef: bundle.annotatedScreenshotRef || item.screenshot.annotatedScreenshotRef,
                }
                : item.screenshot,
            }
            : item),
        }));
        setWorkspaceStatus(`Feedback evidence saved to ${bundle.evidenceBundleRef}`);
      })
      .catch((error) => {
        setWorkspaceStatus(`Feedback was saved locally, but the evidence bundle was not written: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  function updateFeedbackStatus(ids: string[], status: FeedbackCommentStatus) {
    if (!ids.length) return;
    updateWorkspace((current) => updateFeedbackCommentStatus(current, ids, status, nowIso()));
  }

  function updateFeedbackCommentTextAction(id: string, comment: string) {
    if (!id) return;
    updateWorkspace((current) => updateFeedbackCommentText(current, id, comment, nowIso()));
  }

  function deleteFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    updateWorkspace((current) => deleteFeedbackCommentsFromWorkspace(current, ids));
  }

  function restoreFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    updateWorkspace((current) => restoreFeedbackCommentsInWorkspace(current, ids));
  }

  function createFeedbackRequest(ids: string[], title: string) {
    if (!ids.length) return;
    updateWorkspace((current) => createFeedbackRequestFromComments(current, ids, title));
  }

  function recordFeedbackRepairRun(run: FeedbackRepairRunRecord) {
    updateWorkspace((current) => upsertFeedbackRepairRunInWorkspace(current, run));
  }

  function recordFeedbackRepairResult(result: FeedbackRepairResultRecord) {
    updateWorkspace((current) => upsertFeedbackRepairResultInWorkspace(current, result));
  }

  function recordFeedbackRepairAction(action: FeedbackRepairActionRecord) {
    updateWorkspace((current) => upsertFeedbackRepairActionInWorkspace(current, action));
  }

  function recordFeedbackRepairGuidance(guidance: FeedbackRepairGuidanceRecord) {
    updateWorkspace((current) => upsertFeedbackRepairGuidanceInWorkspace(current, guidance));
  }

  function recordFeedbackEvidenceUpload(comment: FeedbackCommentRecord) {
    updateWorkspace((current) => ({
      ...current,
      feedbackComments: (current.feedbackComments ?? []).map((item) => item.id === comment.id
        ? {
          ...item,
          evidenceAssets: comment.evidenceAssets?.length ? comment.evidenceAssets : item.evidenceAssets,
          updatedAt: comment.updatedAt || item.updatedAt,
        }
        : item),
    }));
  }

  function replaceGithubSyncedOpenIssues(issues: GithubSyncedOpenIssueRecord[]) {
    updateWorkspace((current) => replaceGithubSyncedOpenIssuesInWorkspace(current, issues, nowIso()));
  }

  function recordGithubIssueCreated(commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) {
    updateWorkspace((current) => markFeedbackGithubIssueCreated(current, commentIds, issue));
  }

  function recordGithubIssueClosed(commentIds: string[], issue: { number: number; htmlUrl?: string; title?: string; commentUrl?: string; updatedAt?: string }) {
    updateWorkspace((current) => markFeedbackGithubIssueClosed(current, commentIds, issue));
  }

  function recordGithubIssueSyncPending(commentIds: string[]) {
    updateWorkspace((current) => markFeedbackGithubIssueSyncPending(current, commentIds));
  }

  function recordGithubIssueSyncFailed(commentIds: string[], error: unknown) {
    updateWorkspace((current) => markFeedbackGithubIssueSyncFailed(current, commentIds, error));
  }

  function importGithubOpenIssuesAsFeedback(issues: GithubSyncedOpenIssueRecord[]) {
    const preview = applyGithubOpenIssuesAsFeedback(workspaceState, issues, nowIso(), APP_BUILD_ID);
    updateWorkspace((current) => applyGithubOpenIssuesAsFeedback(current, issues, nowIso(), APP_BUILD_ID).state);
    return preview.changed;
  }

  return {
    addFeedbackComment,
    updateFeedbackStatus,
    updateFeedbackCommentText: updateFeedbackCommentTextAction,
    deleteFeedbackComments,
    restoreFeedbackComments,
    createFeedbackRequest,
    recordFeedbackRepairRun,
    recordFeedbackRepairResult,
    recordFeedbackRepairAction,
    recordFeedbackRepairGuidance,
    recordFeedbackEvidenceUpload,
    replaceGithubSyncedOpenIssues,
    importGithubOpenIssuesAsFeedback,
    recordGithubIssueSyncPending,
    recordGithubIssueSyncFailed,
    recordGithubIssueCreated,
    recordGithubIssueClosed,
  };
}
