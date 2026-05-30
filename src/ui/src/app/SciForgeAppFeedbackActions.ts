import { referenceComposerMarker } from '../../../../packages/support/object-references';
import type { PageId } from '../data';
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
  updateFeedbackCommentStatus,
} from '../feedback/feedbackWorkspace';
import {
  importGithubOpenIssuesAsFeedback as applyGithubOpenIssuesAsFeedback,
  markFeedbackGithubIssueClosed,
  markFeedbackGithubIssueCreated,
  markFeedbackGithubIssueSyncFailed,
  markFeedbackGithubIssueSyncPending,
} from '../feedback/githubFeedback';
import {
  buildFeedbackEvidenceStatus,
  buildFeedbackRuntimeSnapshot,
  feedbackEvidenceRefs,
} from '../feedback/captureModel';
import { saveFeedbackCommentEvidenceBundle } from '../api/workspaceClient';
import {
  nowIso,
  makeId,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairActionRecord,
  type FeedbackRepairGuidanceRecord,
  type FeedbackRepairResultRecord,
  type FeedbackRepairRunRecord,
  type FeedbackTargetSnapshot,
  type GithubSyncedOpenIssueRecord,
  type ScenarioInstanceId,
  type SciForgeConfig,
  type SciForgeSession,
  type SciForgeWorkspaceState,
} from '../domain';
import type { BrowserWorkbenchFeedbackBundle } from './BrowserRuntimePage';
import { APP_BUILD_ID } from './appShell/appHelpers';

type WorkspaceUpdater = (mutator: (state: SciForgeWorkspaceState) => SciForgeWorkspaceState) => void;

type SciForgeFeedbackActionsInput = {
  config: SciForgeConfig;
  page: PageId;
  scenarioId: ScenarioInstanceId;
  activeSession: SciForgeSession;
  workspaceState: SciForgeWorkspaceState;
  feedbackAuthor: { authorId: string; authorName: string };
  updateWorkspace: WorkspaceUpdater;
  setWorkspaceStatus: (status: string) => void;
  setPage: (page: PageId) => void;
};

function browserFeedbackTargetSnapshot(bundle: BrowserWorkbenchFeedbackBundle): FeedbackTargetSnapshot {
  const rect = bundle.target?.rect ?? { x: 0, y: 0, width: 1, height: 1 };
  const selector = bundle.target?.selector
    ?? bundle.target?.stableRef?.signals.selector
    ?? `browser-${bundle.kind}-target`;
  const text = bundle.target?.text || bundle.comment || bundle.summary;
  return {
    selector,
    stableSelector: selector,
    path: bundle.target?.stableRef?.signals.domPath ?? selector,
    domPath: bundle.target?.stableRef?.signals.domPath ?? selector,
    text,
    textSnippet: text.slice(0, 240),
    tagName: bundle.target?.tagName ?? 'browser-preview',
    role: bundle.target?.role ?? (bundle.kind === 'screenshot' ? 'img' : 'region'),
    label: bundle.summary,
    ariaLabel: bundle.summary,
    rect,
    commentPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
  };
}

export function createSciForgeFeedbackActions({
  config,
  page,
  scenarioId,
  activeSession,
  workspaceState,
  feedbackAuthor,
  updateWorkspace,
  setWorkspaceStatus,
  setPage,
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

  function submitBrowserFeedbackBundle(bundle: BrowserWorkbenchFeedbackBundle) {
    const now = nowIso();
    const feedbackId = makeId('feedback');
    const refs = feedbackEvidenceRefs(feedbackId);
    const target = browserFeedbackTargetSnapshot(bundle);
    const runtime = buildFeedbackRuntimeSnapshot({
      page,
      scenarioId,
      session: activeSession,
      url: bundle.url,
      appVersion: APP_BUILD_ID,
    });
    const evidenceStatus = buildFeedbackEvidenceStatus({
      target,
      runtime,
      diagnostics: [
        'browser workbench feedback is refs-first; screenshot pixels must be produced by browser_runtime snapshot or evidence upload before repair is treated as fully verified',
      ],
    });
    const comment: FeedbackCommentRecord = {
      id: feedbackId,
      schemaVersion: 1,
      authorId: feedbackAuthor.authorId,
      authorName: feedbackAuthor.authorName.trim() || 'Anonymous',
      comment: bundle.comment,
      expectedBehavior: bundle.kind === 'annotation'
        ? `Fix the annotated page region: ${bundle.comment}`
        : 'Browser runtime should produce screenshot and DOM references and turn the page state into a fixable issue.',
      actualBehavior: bundle.kind === 'annotation'
        ? `The page contains the annotated issue area: ${bundle.summary}`
        : 'The user clicked the browser screenshot button; the web UI submits the screenshot request and browser runtime produces the evidence.',
      status: 'open',
      priority: 'normal',
      severity: 'normal',
      tags: ['browser-feedback', bundle.kind, 'self-evolving'],
      createdAt: now,
      updatedAt: now,
      target,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      runtime,
      evidenceBundleRef: refs.evidenceBundleRef,
      evidenceStatus,
      repairPolicy: {
        defaultCommit: false,
        defaultPush: false,
        defaultMerge: false,
        requiresUserConfirmation: true,
        allowedOperations: [
          'read browser feedback bundle',
          'run browser runtime snapshot/state commands',
          'inspect linked route and component code',
          'apply scoped UI/runtime patches after user confirmation',
          'run focused browser and typecheck verification',
        ],
        forbiddenOperations: [
          'commit, push, PR, or merge without explicit user confirmation',
          'delete feedback records or evidence refs',
          'reuse user browser profile or credentials without approval',
          'fabricate screenshot evidence',
        ],
      },
      metadata: {
        browserFeedback: {
          schemaVersion: 1,
          bundleId: bundle.id,
          kind: bundle.kind,
          sourceUrl: bundle.url,
          summary: bundle.summary,
          submitCommand: bundle.submitCommand,
          target: bundle.target,
        },
      },
    };
    addFeedbackComment(comment);
    setWorkspaceStatus(`Browser feedback submitted to the inbox: ${feedbackId}`);
    return feedbackId;
  }

  function requestBrowserFeedbackRepair({ feedbackId }: { feedbackId: string; bundle: BrowserWorkbenchFeedbackBundle }) {
    setWorkspaceStatus(`Feedback inbox opened. Confirm before dispatching repair: ${feedbackId}`);
    setPage('feedback');
  }

  function updateFeedbackStatus(ids: string[], status: FeedbackCommentStatus) {
    if (!ids.length) return;
    updateWorkspace((current) => updateFeedbackCommentStatus(current, ids, status, nowIso()));
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
    submitBrowserFeedbackBundle,
    requestBrowserFeedbackRepair,
    updateFeedbackStatus,
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
