import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CheckCheck, CheckCircle2, ExternalLink, Loader2, Pencil, Save, X } from 'lucide-react';
import { defaultSciForgeConfig } from '../../config';
import {
  confirmFeedbackRepairAction,
  loadFeedbackIssueHandoffBundle,
  loadFeedbackRepairTerminalMirror,
  loadRuntimeCodexBrowserAcceptanceManifest,
  loadRuntimeProviderPreflightManifest,
  loadSciForgeInstanceManifest,
  loadWorkspaceWriterHealth,
  runFeedbackIssueRepairHandoff,
  saveFeedbackIssueRepairResult,
  sendFeedbackRepairGuidance,
  stopFeedbackRepairHandoff,
  uploadFeedbackEvidenceAssets,
} from '../../api/workspaceClient';
import { buildFeedbackBundle, buildFeedbackGithubIssueBody, buildFeedbackGithubIssueTitle, buildFeedbackRepairClosureReport, submitFeedbackGithubIssue, syncFeedbackGithubIssues, syncFeedbackRepairClosure } from '../../feedback/githubFeedback';
import { feedbackRepairAuditForIssue, type FeedbackRepairAuditViewModel } from '../../feedback/feedbackWorkspace';
import { FeedbackRepairAuditPanel, repairSafeMode } from '../../feedback/FeedbackRepairAuditPanel';
import { FeedbackCodexTerminalPanel } from '../../feedback/FeedbackCodexTerminalPanel';
import { ANNOTATION_PLAN_SOURCE } from '../../feedback/annotationPlanModel';
import { makeId, nowIso, type FeedbackCommentRecord, type FeedbackCommentStatus, type FeedbackRepairActionRecord, type FeedbackRepairGuidanceRecord, type FeedbackRepairHumanVerification, type FeedbackRepairResultRecord, type FeedbackRepairRunRecord, type GithubSyncedOpenIssueRecord, type PeerInstance, type RuntimeCodexBrowserAcceptanceManifest, type RuntimeProviderPreflightManifest, type SciForgeConfig, type SciForgeWorkspaceState } from '../../domain';
import { exportJsonFile } from '../exportUtils';
import { APP_BUILD_ID, feedbackStatusVariant, formatSessionTime, requestTitleFromFeedback } from '../appShell/appHelpers';
import { Badge, cx } from '../uiPrimitives';
import { FeedbackActionConfirmation } from './FeedbackActionConfirmation';
import { FeedbackEvidenceReview, feedbackEvidenceSummary } from './FeedbackEvidenceReview';
import { FeedbackInboxToolbar, FEEDBACK_STATUS_FILTERS, type FeedbackGitOperationMode, type FeedbackStatusFilter } from './FeedbackInboxToolbar';
import { FeedbackRepairResolutionComposer } from './FeedbackRepairResolutionComposer';
import { buildBlockedRepairHandoffResultInput, DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY, type RepairBlockedFailureKind } from './feedbackBlockedRepairResult';
import { repairPeerReadinessFromProbe, repairReadinessSummary, type RepairPeerReadinessByName, type RepairPeerReadinessProbe } from './feedbackRepairReadiness';

type PendingGithubActionKind = 'submit-issue' | 'sync-open-issues';
type PendingQueueActionKind = 'soft-delete';

interface PendingGithubAction {
  kind: PendingGithubActionKind;
  repo: string;
  commentIds: string[];
  count: number;
  scopeLabel: string;
}

interface PendingQueueAction {
  kind: PendingQueueActionKind;
  commentIds: string[];
  count: number;
  scopeLabel: string;
}

interface PendingRepairAction {
  issueId: string;
  action: FeedbackRepairActionRecord['action'];
  safeModeActive: boolean;
  safeModeDetail: string;
}

interface PendingRepairClosure {
  issueId: string;
  result?: FeedbackRepairResultRecord;
  report: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
}

const DEFAULT_FEEDBACK_REPAIR_TESTS = [
  { name: 'typecheck', command: 'npm run typecheck' },
  { name: 'diff-check', command: 'git diff --check' },
];

const DEFAULT_FEEDBACK_ALLOWED_WRITE_PATHS = ['src', 'packages', 'tests', 'docs', 'PROJECT.md'];
const DEFAULT_FEEDBACK_FORBIDDEN_WRITE_PATHS = ['.git', '.sciforge/feedback', '.sciforge/repair-results', '.sciforge/repair-worktrees', 'config.local.json', '.env', '.env.local'];
function repairTerminalMirrorRef(workspacePath: string, repairRunId: string) {
  return `${workspacePath.replace(/\/+$/, '')}/.sciforge/repair-results/${repairRunId}/terminal-mirror.ndjson`;
}

export function FeedbackInboxPage({
  config,
  comments,
  requests,
  repairRuns,
  repairResults,
  repairActions,
  repairGuidance,
  onStatusChange,
  onCommentEdit,
  onDelete,
  onRestore,
  onCreateRequest,
  onRepairActionWritten,
  onRepairGuidanceWritten,
  onFeedbackEvidenceUploaded,
  onRepairRunWritten,
  onRepairResultWritten,
  feedbackGithubRepo,
  detectedGithubRepo,
  feedbackGithubToken,
  githubSyncedOpenIssues,
  onReplaceGithubSyncedOpenIssues,
  onImportGithubOpenIssues,
  onGithubIssueSyncPending,
  onGithubIssueSyncFailed,
  onGithubIssueCreated,
  onGithubIssueClosed,
  onOpenGithubSettings,
}: {
  config: SciForgeConfig;
  comments: FeedbackCommentRecord[];
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>;
  repairRuns: FeedbackRepairRunRecord[];
  repairResults: FeedbackRepairResultRecord[];
  repairActions: FeedbackRepairActionRecord[];
  repairGuidance: FeedbackRepairGuidanceRecord[];
  onStatusChange: (ids: string[], status: FeedbackCommentStatus) => void;
  onCommentEdit: (id: string, comment: string) => void;
  onDelete: (ids: string[]) => void;
  onRestore: (ids: string[]) => void;
  onCreateRequest: (ids: string[], title: string) => void;
  onRepairActionWritten: (action: FeedbackRepairActionRecord) => void;
  onRepairGuidanceWritten: (guidance: FeedbackRepairGuidanceRecord) => void;
  onFeedbackEvidenceUploaded: (comment: FeedbackCommentRecord) => void;
  onRepairRunWritten: (run: FeedbackRepairRunRecord) => void;
  onRepairResultWritten: (result: FeedbackRepairResultRecord) => void;
  feedbackGithubRepo?: string;
  detectedGithubRepo?: string;
  feedbackGithubToken?: string;
  githubSyncedOpenIssues: GithubSyncedOpenIssueRecord[];
  onReplaceGithubSyncedOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => void;
  onImportGithubOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => number;
  onGithubIssueSyncPending: (commentIds: string[]) => void;
  onGithubIssueSyncFailed: (commentIds: string[], error: unknown) => void;
  onGithubIssueCreated: (commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) => void;
  onGithubIssueClosed: (commentIds: string[], issue: { number: number; htmlUrl?: string; title?: string; commentUrl?: string; updatedAt?: string }) => void;
  onOpenGithubSettings: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkStatus, setBulkStatus] = useState<FeedbackCommentStatus>('triaged');
  const [editingCommentId, setEditingCommentId] = useState<string | undefined>();
  const [editingCommentDraft, setEditingCommentDraft] = useState('');
  const [queueActionHint, setQueueActionHint] = useState('');
  const [githubActionHint, setGithubActionHint] = useState('');
  const [githubSubmitBusy, setGithubSubmitBusy] = useState(false);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [evidenceUploadBusy, setEvidenceUploadBusy] = useState(false);
  const [pendingGithubAction, setPendingGithubAction] = useState<PendingGithubAction | undefined>();
  const [pendingQueueAction, setPendingQueueAction] = useState<PendingQueueAction | undefined>();
  const [pendingRepairAction, setPendingRepairAction] = useState<PendingRepairAction | undefined>();
  const [pendingRepairClosure, setPendingRepairClosure] = useState<PendingRepairClosure | undefined>();
  const [repairActionSafeModeConfirmed, setRepairActionSafeModeConfirmed] = useState(false);
  const [gitOperationMode, setGitOperationMode] = useState<FeedbackGitOperationMode>('manual');
  const [handoffBusyById, setHandoffBusyById] = useState<Record<string, boolean>>({});
  const [handoffTargetById, setHandoffTargetById] = useState<Record<string, string>>({});
  const [handoffHintById, setHandoffHintById] = useState<Record<string, string>>({});
  const [remainingProblemById, setRemainingProblemById] = useState<Record<string, string>>({});
  const [runtimePreflightManifest, setRuntimePreflightManifest] = useState<RuntimeProviderPreflightManifest | undefined>();
  const [runtimePreflightError, setRuntimePreflightError] = useState('');
  const [browserAcceptanceManifest, setBrowserAcceptanceManifest] = useState<RuntimeCodexBrowserAcceptanceManifest | undefined>();
  const [browserAcceptanceError, setBrowserAcceptanceError] = useState('');
  const effectiveGithubRepo = useMemo(
    () => {
      const configured = feedbackGithubRepo?.trim();
      const detected = detectedGithubRepo?.trim();
      if (configured && configured !== defaultSciForgeConfig.feedbackGithubRepo) return configured;
      return (detected || configured || defaultSciForgeConfig.feedbackGithubRepo || '').trim();
    },
    [detectedGithubRepo, feedbackGithubRepo],
  );
  const effectiveGithubLabels = useMemo(
    () => [...new Set((config.feedbackGithubLabels ?? []).map((label) => label.trim()).filter(Boolean))],
    [config.feedbackGithubLabels],
  );
  const effectiveGithubAssignees = useMemo(
    () => [...new Set((config.feedbackGithubAssignees ?? []).map((assignee) => assignee.trim()).filter(Boolean))],
    [config.feedbackGithubAssignees],
  );
  const effectiveGithubMilestone = typeof config.feedbackGithubMilestone === 'number' || typeof config.feedbackGithubMilestone === 'string'
    ? config.feedbackGithubMilestone
    : undefined;
  const githubDryRun = config.feedbackGithubDryRun === true;
  const configuredRepairTargets = useMemo(
    () => (config.peerInstances ?? []).filter((peer) => peer.enabled && peer.trustLevel === 'repair'),
    [config.peerInstances],
  );
  const localDirectRepairTarget = useMemo<PeerInstance>(() => ({
    name: 'current workspace',
    appUrl: '',
    workspaceWriterUrl: config.workspaceWriterBaseUrl,
    workspacePath: config.workspacePath,
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
  }), [config.workspacePath, config.workspaceWriterBaseUrl]);
  const repairTargets = useMemo(
    () => configuredRepairTargets.length ? configuredRepairTargets : [localDirectRepairTarget],
    [configuredRepairTargets, localDirectRepairTarget],
  );
  const repairTargetProbeKey = useMemo(
    () => configuredRepairTargets.map((peer) => `${peer.name}|${peer.workspaceWriterUrl}|${peer.workspacePath}`).join('||'),
    [configuredRepairTargets],
  );
  const [peerReadinessByName, setPeerReadinessByName] = useState<RepairPeerReadinessByName>({});
  const repairReadiness = useMemo(
    () => repairReadinessSummary(config.peerInstances ?? [], configuredRepairTargets, runtimePreflightManifest, runtimePreflightError, browserAcceptanceManifest, browserAcceptanceError, peerReadinessByName),
    [browserAcceptanceError, browserAcceptanceManifest, config.peerInstances, configuredRepairTargets, peerReadinessByName, runtimePreflightError, runtimePreflightManifest],
  );
  const statusCounts = useMemo(() => feedbackStatusCounts(comments), [comments]);
  const activeComments = comments.filter((comment) => comment.status !== 'deleted');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleComments = comments
    .filter((comment) => statusFilter === 'all' ? comment.status !== 'deleted' : comment.status === statusFilter)
    .filter((comment) => feedbackCommentMatchesSearch(comment, normalizedSearchQuery))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const selectedComments = comments.filter((comment) => selectedIds.includes(comment.id));
  const selectedVisibleComments = visibleComments.filter((comment) => selectedIds.includes(comment.id));
  const selectedVisibleActiveComments = selectedVisibleComments.filter((comment) => comment.status !== 'deleted');
  const selectedRepairCandidate = selectedVisibleActiveComments.length === 1 ? selectedVisibleActiveComments[0] : undefined;
  const selectedDeletedIds = selectedVisibleComments.filter((comment) => comment.status === 'deleted').map((comment) => comment.id);
  const bundleScopeComments = selectedVisibleComments.length ? selectedVisibleComments : visibleComments;
  const bundle = buildFeedbackBundle(bundleScopeComments, requests, APP_BUILD_ID);
  const issueScopeComments = selectedVisibleActiveComments.length ? selectedVisibleActiveComments : visibleComments.filter((comment) => comment.status !== 'deleted');
  const issueTitle = buildFeedbackGithubIssueTitle(issueScopeComments);
  const issueBody = buildFeedbackGithubIssueBody(issueScopeComments, requests, APP_BUILD_ID);
  const visibleIds = visibleComments.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const hiddenSelectedCount = Math.max(0, selectedIds.length - visibleSelectedCount);
  const selectionSummary = selectedIds.length
    ? hiddenSelectedCount
      ? `当前列表已选 ${visibleSelectedCount} 条；另有 ${hiddenSelectedCount} 条隐藏选择不参与当前操作`
      : `已选择 ${visibleSelectedCount} 条`
    : `当前列表 ${visibleComments.length} 条`;
  const issueScopeLabel = selectedVisibleActiveComments.length
    ? `当前可见已选 ${selectedVisibleActiveComments.length} 条反馈`
    : `当前筛选和搜索结果中的 ${issueScopeComments.length} 条未删除反馈`;
  useEffect(() => {
    let cancelled = false;
    setRuntimePreflightError('');
    setBrowserAcceptanceError('');
    loadRuntimeProviderPreflightManifest(config).then((manifest) => {
      if (!cancelled) setRuntimePreflightManifest(manifest);
    }).catch((error) => {
      if (cancelled) return;
      setRuntimePreflightManifest(undefined);
      setRuntimePreflightError(error instanceof Error ? error.message : String(error));
    });
    loadRuntimeCodexBrowserAcceptanceManifest(config).then((manifest) => {
      if (!cancelled) setBrowserAcceptanceManifest(manifest);
    }).catch((error) => {
      if (cancelled) return;
      setBrowserAcceptanceManifest(undefined);
      setBrowserAcceptanceError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [config.workspacePath, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!configuredRepairTargets.length) {
      setPeerReadinessByName({});
      return () => {
        cancelled = true;
      };
    }
    setPeerReadinessByName(Object.fromEntries(configuredRepairTargets.map((peer) => [peer.name, {
      peerName: peer.name,
      status: 'checking' as const,
      checkedAt: nowIso(),
      diagnostics: ['Checking peer writer health and instance manifest.'],
    }])));
    Promise.all(configuredRepairTargets.map(async (peer) => {
      const targetConfig = {
        ...config,
        workspaceWriterBaseUrl: peer.workspaceWriterUrl,
        workspacePath: peer.workspacePath,
      };
      const [health, manifest] = await Promise.allSettled([
        loadWorkspaceWriterHealth(targetConfig, peer.workspaceWriterUrl),
        loadSciForgeInstanceManifest(targetConfig, peer.workspacePath),
      ]);
      return [peer.name, repairPeerReadinessFromProbe(peer, health, manifest)] as const;
    })).then((entries) => {
      if (!cancelled) setPeerReadinessByName(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [config, configuredRepairTargets, repairTargetProbeKey]);

  function ensureGithubTokenOrOpenSettings(): boolean {
    const token = feedbackGithubToken?.trim();
    if (token) return true;
    setGithubActionHint(`需要 GitHub Personal Access Token：已打开「设置」，请在「反馈 GitHub Token」填写（需 Issues 读写）。当前仓库 ${effectiveGithubRepo || '（未解析）'}。`);
    onOpenGithubSettings();
    return false;
  }

  async function uploadEvidenceForComments(targetComments: FeedbackCommentRecord[], source: 'manual' | 'github-submit') {
    const uploadable = targetComments.filter(hasUploadableEvidenceAsset);
    if (!uploadable.length) return targetComments;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken?.trim();
    const byId = new Map(targetComments.map((comment) => [comment.id, comment]));
    const failed: string[] = [];
    for (const comment of uploadable) {
      try {
        const uploaded = await uploadFeedbackEvidenceAssets(config, comment.id, {
          repo,
          token,
          commitMessage: `Upload SciForge repair evidence ${comment.id}`,
        });
        if (uploaded.comment) {
          onFeedbackEvidenceUploaded(uploaded.comment);
          byId.set(comment.id, uploaded.comment);
        }
        if (uploaded.diagnostics?.length) failed.push(...uploaded.diagnostics);
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failed.length) {
      setGithubActionHint(`Evidence upload 已记录，但部分对象未完成上传：${failed.slice(0, 2).join('；')}`);
    } else if (source === 'manual') {
      setGithubActionHint(`Evidence upload 完成：${uploadable.length} 条反馈的 scrubbed screenshot 已更新托管 URL。`);
    }
    return targetComments.map((comment) => byId.get(comment.id) ?? comment);
  }

  function commentsForPendingAction(action: PendingGithubAction) {
    if (!action.commentIds.length) return issueScopeComments;
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    return action.commentIds
      .map((id) => byId.get(id))
      .filter((comment): comment is FeedbackCommentRecord => Boolean(comment && comment.status !== 'deleted'));
  }

  function requestGithubAction(kind: PendingGithubActionKind) {
    const repo = effectiveGithubRepo;
    if ((kind === 'submit-issue' || kind === 'sync-open-issues') && !repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    if (kind === 'sync-open-issues') {
      if (!ensureGithubTokenOrOpenSettings()) return;
      setPendingGithubAction({
        kind,
        repo,
        commentIds: [],
        count: 500,
        scopeLabel: 'GitHub open issues pull/sync',
      });
      setGithubActionHint(`等待确认：将向 ${repo} 读取未关闭 Issue，并只写入本地同步缓存。`);
      return;
    }
    if (!issueScopeComments.length) return;
    if (githubDryRun) {
      void submitGithubIssueApi(issueScopeComments);
      return;
    }
    if (!ensureGithubTokenOrOpenSettings()) return;
    setPendingGithubAction({
      kind,
      repo,
      commentIds: issueScopeComments.map((comment) => comment.id),
      count: issueScopeComments.length,
      scopeLabel: issueScopeLabel,
    });
    setGithubActionHint(`等待确认：将向 ${repo} 创建 1 个 GitHub Issue，范围为${issueScopeLabel}。`);
  }

  function cancelPendingGithubAction() {
    if (!pendingGithubAction) return;
    setGithubActionHint(`已取消 GitHub 外部操作：${githubActionTitle(pendingGithubAction.kind)}。${githubActionCancelImpact(pendingGithubAction.kind)}`);
    setPendingGithubAction(undefined);
  }

  async function confirmPendingGithubAction() {
    const action = pendingGithubAction;
    if (!action) return;
    setPendingGithubAction(undefined);
    if (action.kind === 'sync-open-issues') {
      await syncGithubOpenIssues();
      return;
    }
    await submitGithubIssueApi(commentsForPendingAction(action));
  }

  async function submitGithubIssueApi(targetComments = issueScopeComments) {
    if (!targetComments.length) return;
    if (!githubDryRun && !ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken?.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSubmitBusy(true);
    if (!githubDryRun) setEvidenceUploadBusy(true);
    const submittedIds = targetComments.map((comment) => comment.id);
    if (!githubDryRun) onGithubIssueSyncPending(submittedIds);
    try {
      const uploadedScopeComments = githubDryRun
        ? targetComments
        : await uploadEvidenceForComments(targetComments, 'github-submit');
      const body = buildFeedbackGithubIssueBody(uploadedScopeComments, requests, APP_BUILD_ID);
      const title = buildFeedbackGithubIssueTitle(uploadedScopeComments);
      const created = await submitFeedbackGithubIssue({
        repo,
        token,
        title,
        body,
        labels: effectiveGithubLabels,
        assignees: effectiveGithubAssignees,
        milestone: effectiveGithubMilestone,
        dryRun: githubDryRun,
      });
      if ('dryRun' in created && created.dryRun) {
        setGithubActionHint(`Dry-run 完成：不会创建 GitHub Issue，本地反馈保持当前状态。预览 URL：${created.htmlUrl}`);
        return;
      }
      onGithubIssueCreated(submittedIds, {
        number: created.number,
        htmlUrl: created.htmlUrl,
        title,
      });
      setGithubActionHint(`已创建 Issue #${created.number}，正在打开页面…`);
      window.open(created.htmlUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if (!githubDryRun) onGithubIssueSyncFailed(submittedIds, error);
      setGithubActionHint(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubSubmitBusy(false);
      if (!githubDryRun) setEvidenceUploadBusy(false);
    }
  }

  async function syncGithubOpenIssues() {
    if (!ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken!.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSyncBusy(true);
    try {
      const syncedAt = nowIso();
      const mapped = await syncFeedbackGithubIssues(repo, token, syncedAt);
      onReplaceGithubSyncedOpenIssues(mapped.slice(0, 500));
      const imported = onImportGithubOpenIssues(mapped.slice(0, 500));
      setGithubActionHint(`已同步 ${mapped.length} 条未关闭 Issue（不含 PR），导入/更新 ${imported} 条本地反馈。`);
    } catch (error) {
      setGithubActionHint(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubSyncBusy(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function markSelected(status: FeedbackCommentStatus) {
    const ids = selectedVisibleActiveComments.map((comment) => comment.id);
    if (!ids.length) return;
    onStatusChange(ids, status);
    setQueueActionHint(`已把当前可见已选 ${ids.length} 条反馈标记为 ${feedbackStatusLabel(status)}。隐藏选择没有被修改。`);
  }

  function requestSoftDeleteSelected(ids: string[]) {
    if (!ids.length) return;
    setPendingQueueAction({
      kind: 'soft-delete',
      commentIds: ids,
      count: ids.length,
      scopeLabel: `当前可见已选 ${ids.length} 条未删除反馈`,
    });
    setQueueActionHint(`等待确认：将软删除当前可见已选 ${ids.length} 条本地反馈；GitHub、repair audit、patch 和截图证据不会被删除。`);
  }

  function cancelPendingQueueAction() {
    if (!pendingQueueAction) return;
    setQueueActionHint(`已取消本地队列操作：${queueActionTitle(pendingQueueAction.kind)}。没有改动本地反馈、GitHub Issue、repair audit 或截图证据。`);
    setPendingQueueAction(undefined);
  }

  function confirmPendingQueueAction() {
    const action = pendingQueueAction;
    if (!action) return;
    setPendingQueueAction(undefined);
    if (action.kind === 'soft-delete') {
      onDelete(action.commentIds);
      setSelectedIds((current) => current.filter((id) => !action.commentIds.includes(id)));
      setQueueActionHint(`已软删除 ${action.count} 条本地反馈；GitHub、repair audit、patch 和截图证据已保留。`);
    }
  }

  function restoreSelected(ids: string[]) {
    if (!ids.length) return;
    onRestore(ids);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    setQueueActionHint(`已恢复当前可见已选 ${ids.length} 条软删除反馈；原状态和证据 refs 已保留。`);
  }

  function openGithubIssue(event: ReactMouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    if (!url.trim()) return;
    window.location.assign(url);
  }

  async function handoffFeedbackIssue(item: FeedbackCommentRecord, input: { initialGuidance?: string } = {}) {
    const targetName = handoffTargetById[item.id] || repairTargets[0]?.name || '';
    const target = repairTargets.find((peer) => peer.name === targetName);
    const selectedPeerReadiness = target ? peerReadinessByName[target.name] : undefined;
    const initialGuidance = input.initialGuidance?.trim();
    if (!target) {
      setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
      try {
        const message = '没有可用的 repair 目标实例。请先配置 enabled + repair trust 的 peer instance。';
        const repairRun = blockedRepairTerminalRun(item, {
          failureKind: 'missing-repair-peer',
          message,
          initialGuidance,
        });
        onRepairRunWritten(repairRun);
        const result = await persistBlockedRepairHandoffResult(item, {
          failureKind: 'missing-repair-peer',
          message,
          repairRun,
          initialGuidance,
        });
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit written: ${result.summary}` }));
      } catch (error) {
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit write failed：${error instanceof Error ? error.message : String(error)}` }));
      } finally {
        setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
      }
      return;
    }
    const targetConfig = {
      ...config,
      workspaceWriterBaseUrl: target.workspaceWriterUrl,
      workspacePath: target.workspacePath,
    };
    let repairRun: FeedbackRepairRunRecord | undefined;
    setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
    const repairRunId = makeId('feedback-repair-run');
    const startedAt = nowIso();
    const terminalMirrorRef = repairTerminalMirrorRef(target.workspacePath, repairRunId);
    const preparingRun: FeedbackRepairRunRecord = {
      schemaVersion: 1,
      id: repairRunId,
      issueId: item.id,
      status: 'running',
      externalInstanceId: target.name,
      externalInstanceName: target.name,
      actor: 'runtime-codex-repair-handoff',
      startedAt,
      note: initialGuidance
        ? `Runtime Codex repair is preparing for ${target.name}; initial repair guidance: ${initialGuidance}`
        : `Runtime Codex repair is preparing for ${target.name}; repair log evidence will stream dispatch events.`,
      terminalMirrorRef,
      planRef: `${target.workspacePath.replace(/\/+$/, '')}/.sciforge/repair-results/${repairRunId}/repair-request-plan.json`,
      terminalMirror: [
        { timestamp: startedAt, stream: 'event', text: `Feedback Inbox repair requested for ${item.id}.` },
        { timestamp: startedAt, stream: 'event', text: `Target: ${target.name}.` },
        ...(initialGuidance ? [{ timestamp: startedAt, stream: 'event' as const, text: `Initial user repair guidance: ${initialGuidance}` }] : []),
        { timestamp: startedAt, stream: 'event', text: 'Preparing feedback bundle, target manifest, and Runtime Codex dispatch.' },
      ],
      confirmationPolicy: DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY,
      metadata: {
        handoffKind: 'feedback-repair',
        executorBackend: 'runtime-codex',
        terminalMirrorRef,
        runtimeProfile: config.runtimeProfile || defaultSciForgeConfig.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        sourceWorkspacePath: config.workspacePath,
        targetWorkspacePath: target.workspacePath,
        targetAppUrl: target.appUrl,
        targetWorkspaceWriterUrl: target.workspaceWriterUrl,
        targetPeerReadiness: selectedPeerReadiness,
        initialTerminalGuidance: initialGuidance,
        gitMode: gitOperationMode,
        providerReadinessNotice: {
          ready: repairReadiness.providerReady,
          blocker: repairReadiness.providerBlocker,
          displayOnly: true,
        },
        dispatchPhase: 'preparing',
      },
    };
    repairRun = preparingRun;
    onRepairRunWritten(preparingRun);
    setHandoffHintById((current) => ({ ...current, [item.id]: `Repair run ${repairRunId} 已创建，正在准备 ${target.name} 的 Runtime Codex 调度...` }));
    try {
      const executorManifestPromise = loadSciForgeInstanceManifest(config, config.workspacePath).catch(() => undefined);
      const targetManifestPromise = loadSciForgeInstanceManifest(targetConfig, target.workspacePath)
        .then((value) => ({ status: 'fulfilled' as const, value, source: 'target-writer' as const }))
        .catch(async (reason) => {
          try {
            const value = await loadSciForgeInstanceManifest(config, target.workspacePath);
            return {
              status: 'fulfilled' as const,
              value,
              source: 'current-writer-fallback' as const,
              targetWriterError: String(reason),
            };
          } catch (fallbackReason) {
            return {
              status: 'rejected' as const,
              reason: `${String(reason)}; current writer fallback failed: ${String(fallbackReason)}`,
            };
          }
        });
      const [bundle, manifestResult, executorManifest] = await Promise.all([
        loadFeedbackIssueHandoffBundle(config, item.id),
        targetManifestPromise,
        executorManifestPromise,
      ]);
      const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : undefined;
      const usingCurrentWriterFallback = manifestResult.status === 'fulfilled' && manifestResult.source === 'current-writer-fallback';
      const executorName = manifest?.instance.name || target.name;
      const executorId = manifest?.instance.id || target.name;
      const resolvedTargetRepoRoot = manifest?.repo?.root || target.workspacePath;
      const resolvedTargetWorkspacePath = usingCurrentWriterFallback ? config.workspacePath : target.workspacePath;
      const resolvedTargetWorkspaceWriterUrl = usingCurrentWriterFallback ? config.workspaceWriterBaseUrl : target.workspaceWriterUrl;
      const resolvedTerminalMirrorRef = repairTerminalMirrorRef(resolvedTargetRepoRoot, repairRunId);
      const resolvedPlanRef = `${resolvedTargetRepoRoot.replace(/\/+$/, '')}/.sciforge/repair-results/${repairRunId}/repair-request-plan.json`;
      const run: FeedbackRepairRunRecord = {
        ...preparingRun,
        externalInstanceId: executorId,
        externalInstanceName: executorName,
        note: initialGuidance
          ? `Runtime Codex repair handoff started for ${executorName}; initial repair guidance: ${initialGuidance}`
          : `Runtime Codex repair handoff started for ${executorName}; commit/push/PR/merge remain disabled without explicit confirmation.`,
        terminalMirrorRef: resolvedTerminalMirrorRef,
        planRef: resolvedPlanRef,
        terminalMirror: [
          ...(preparingRun.terminalMirror ?? []),
          { timestamp: nowIso(), stream: 'event' as const, text: `Dispatching Runtime Codex repair from current workspace writer to ${executorName}.` },
        ],
        metadata: {
          ...(isRecord(preparingRun.metadata) ? preparingRun.metadata : {}),
          sourceWorkspacePath: config.workspacePath || bundle?.workspacePath,
          handoffBundle: bundle,
          targetManifest: manifest,
          targetManifestUnavailable: manifestResult.status === 'rejected' ? String(manifestResult.reason) : undefined,
          targetManifestSource: manifestResult.status === 'fulfilled' ? manifestResult.source : undefined,
          targetWriterManifestError: manifestResult.status === 'fulfilled' && 'targetWriterError' in manifestResult ? manifestResult.targetWriterError : undefined,
          terminalMirrorRef: resolvedTerminalMirrorRef,
          planRef: resolvedPlanRef,
          targetWorkspacePath: resolvedTargetWorkspacePath,
          targetWorkspaceWriterUrl: resolvedTargetWorkspaceWriterUrl,
          targetWriterFallbackToCurrent: usingCurrentWriterFallback,
          dispatchPhase: 'dispatching',
        },
      };
      repairRun = run;
      onRepairRunWritten(run);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Runtime Codex 正在 ${target.name} 的隔离 worktree 中修复...` }));
      const result = await runFeedbackIssueRepairHandoff(config, {
        executorInstance: {
          id: executorManifest?.instance.id || config.workspacePath || 'sciforge-feedback-inbox',
          name: executorManifest?.instance.name || 'SciForge Feedback Inbox',
          workspaceWriterUrl: config.workspaceWriterBaseUrl,
          workspacePath: config.workspacePath,
        },
        targetInstance: {
          id: manifest?.instance.id || target.name,
          name: manifest?.instance.name || target.name,
          appUrl: target.appUrl,
          workspaceWriterUrl: resolvedTargetWorkspaceWriterUrl,
          workspacePath: resolvedTargetWorkspacePath,
        },
        targetWorkspacePath: resolvedTargetWorkspacePath,
        targetWorkspaceWriterUrl: resolvedTargetWorkspaceWriterUrl,
        issueBundle: bundle,
        expectedTests: DEFAULT_FEEDBACK_REPAIR_TESTS,
        githubSyncRequired: Boolean(item.githubIssueUrl || item.githubIssueNumber),
        repairRunId,
        executorBackend: 'runtime-codex',
        runtimeProfile: config.runtimeProfile || defaultSciForgeConfig.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        gitMode: gitOperationMode,
        allowExecutorRepoTarget: usingCurrentWriterFallback,
        allowedWritePaths: DEFAULT_FEEDBACK_ALLOWED_WRITE_PATHS,
        forbiddenWritePaths: DEFAULT_FEEDBACK_FORBIDDEN_WRITE_PATHS,
        requestMetadata: {
          source: 'feedback-inbox',
          feedbackId: item.id,
          requestId: item.requestId,
          evidenceRefs: feedbackEvidenceRefList(item),
          targetWorkspacePath: resolvedTargetWorkspacePath,
          targetPeerReadiness: selectedPeerReadiness,
          initialTerminalGuidance: initialGuidance,
          gitMode: gitOperationMode,
          providerReadinessNotice: {
            ready: repairReadiness.providerReady,
            blocker: repairReadiness.providerBlocker,
            displayOnly: true,
          },
          targetWriterFallbackToCurrent: usingCurrentWriterFallback,
        },
        initialGuidance,
        confirmationPolicy: DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY,
      });
      onRepairResultWritten(result);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Runtime Codex repair finished: ${result.verdict}。Patch/ref 已写入 audit。` }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await persistBlockedRepairHandoffResult(item, {
        failureKind: 'runtime-codex-handoff-failed',
        message,
        repairRun,
        target,
        initialGuidance,
      }).catch(() => undefined);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Runtime Codex repair handoff failed closed：${message}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  function blockedRepairTerminalRun(
    item: FeedbackCommentRecord,
    input: {
      failureKind: RepairBlockedFailureKind;
      message: string;
      target?: PeerInstance;
      initialGuidance?: string;
    },
  ): FeedbackRepairRunRecord {
    const repairRunId = makeId('feedback-repair-run');
    const startedAt = nowIso();
    const terminalMirrorRef = repairTerminalMirrorRef(config.workspacePath, repairRunId);
    const targetName = input.target?.name ?? 'no repair peer';
    return {
      schemaVersion: 1,
      id: repairRunId,
      issueId: item.id,
      status: 'blocked',
      externalInstanceId: input.target?.name,
      externalInstanceName: targetName,
      actor: 'feedback-inbox-preflight',
      startedAt,
      note: `Repair blocked before Codex dispatch: ${input.message}`,
      terminalMirrorRef,
      planRef: `${config.workspacePath.replace(/\/+$/, '')}/.sciforge/repair-results/${repairRunId}/repair-request-plan.json`,
      terminalMirror: [
        { timestamp: startedAt, stream: 'event', text: `Feedback Inbox repair requested for ${item.id}.` },
        { timestamp: startedAt, stream: 'event', text: `Target: ${targetName}.` },
        ...(input.initialGuidance ? [{ timestamp: startedAt, stream: 'event' as const, text: `Initial user repair guidance: ${input.initialGuidance}` }] : []),
        { timestamp: startedAt, stream: 'stderr', text: `Pre-dispatch blocked [${input.failureKind}]: ${input.message}` },
      ],
      confirmationPolicy: DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY,
      metadata: {
        handoffKind: 'feedback-repair',
        executorBackend: 'runtime-codex',
        failureKind: input.failureKind,
        failureMessage: input.message,
        targetWorkspacePath: input.target?.workspacePath,
        targetWorkspaceWriterUrl: input.target?.workspaceWriterUrl,
        initialTerminalGuidance: input.initialGuidance,
        terminalMirrorRef,
      },
    };
  }

  async function persistBlockedRepairHandoffResult(
    item: FeedbackCommentRecord,
    input: {
      failureKind: RepairBlockedFailureKind;
      message: string;
      repairRun?: FeedbackRepairRunRecord;
      target?: PeerInstance;
      peerReadiness?: RepairPeerReadinessProbe;
      initialGuidance?: string;
    },
  ) {
    const completedAt = nowIso();
    const result = await saveFeedbackIssueRepairResult(config, item.id, buildBlockedRepairHandoffResultInput({
      item,
      failureKind: input.failureKind,
      message: input.message,
      completedAt,
      repairRun: input.repairRun,
      target: input.target,
      peerReadiness: input.peerReadiness,
      repairReadiness,
      peerReadinessByName,
      runtimePreflightManifest,
      browserAcceptanceManifest,
      sourceWorkspacePath: config.workspacePath,
      initialGuidance: input.initialGuidance,
    }));
    onRepairResultWritten(result);
    return result;
  }

  function confirmRepairAction(item: FeedbackCommentRecord, action: FeedbackRepairActionRecord['action']) {
    const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults, repairActions, repairGuidance);
    const result = audit.latestResult;
    if (!result) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '没有可确认的 repair result；请先完成 repair handoff。' }));
      return;
    }
    const safeMode = repairSafeMode(audit);
    if (action === 'browser-recheck') {
      void executeRepairAction(item, action, { safeModeConfirmed: false });
      return;
    }
    setRepairActionSafeModeConfirmed(false);
    setPendingRepairAction({
      issueId: item.id,
      action,
      safeModeActive: safeMode.active && action !== 'merge',
      safeModeDetail: safeMode.matchedPaths.join(', ') || 'control surface metadata',
    });
  }

  async function executeRepairAction(
    item: FeedbackCommentRecord,
    action: FeedbackRepairActionRecord['action'],
    options: { safeModeConfirmed: boolean },
  ) {
    const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults, repairActions, repairGuidance);
    const result = audit.latestResult;
    if (!result) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '没有可确认的 repair result；请先完成 repair handoff。' }));
      return;
    }
    let browserVerification: FeedbackRepairActionRecord['browserVerification'];
    if (action === 'browser-recheck') {
      browserVerification = browserRecheckInputForResult(result, browserAcceptanceManifest);
      if (!browserVerification) return;
    }
    setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
    setHandoffHintById((current) => ({ ...current, [item.id]: `正在确认 repair ${action} 策略...` }));
    try {
      const actionConfig = repairActionConfigForResult(config, result, repairTargets);
      const { action: record, result: updatedResult } = await confirmFeedbackRepairAction(actionConfig, item.id, {
        action,
        resultId: result.id,
        confirmed: action === 'commit',
        secondConfirmed: action === 'push' || action === 'pr',
        safeModeConfirmed: options.safeModeConfirmed,
        browserVerification,
      }, actionConfig.workspacePath);
      onRepairActionWritten(record);
      if (updatedResult) onRepairResultWritten(updatedResult);
      setHandoffHintById((current) => ({ ...current, [item.id]: record.message }));
      setPendingRepairAction(undefined);
    } catch (error) {
      setHandoffHintById((current) => ({ ...current, [item.id]: `Repair ${action} failed closed：${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  async function recordRepairResolutionFeedback(
    item: FeedbackCommentRecord,
    result: FeedbackRepairResultRecord,
    resolution: 'solved' | 'remaining',
  ) {
    const remainingProblem = remainingProblemById[item.id]?.trim() ?? '';
    if (resolution === 'remaining' && !remainingProblem) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '请先写下仍然存在的问题，再记录为未解决。' }));
      return;
    }
    setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
    setHandoffHintById((current) => ({ ...current, [item.id]: resolution === 'solved' ? '正在记录：问题已解决。' : '正在记录：仍有问题，并保存剩余问题反馈。' }));
    try {
      const actionConfig = repairActionConfigForResult(config, result, repairTargets);
      const browserVerification = repairResolutionVerificationForResult(result, browserAcceptanceManifest, resolution, remainingProblem);
      const { action: record, result: updatedResult } = await confirmFeedbackRepairAction(actionConfig, item.id, {
        action: 'browser-recheck',
        resultId: result.id,
        confirmed: resolution === 'solved',
        secondConfirmed: false,
        safeModeConfirmed: false,
        browserVerification,
      }, actionConfig.workspacePath);
      onRepairActionWritten(record);
      if (updatedResult) onRepairResultWritten(updatedResult);
      if (resolution === 'remaining') {
        setRemainingProblemById((current) => ({ ...current, [item.id]: '' }));
      }
      if (resolution === 'solved') {
        const closureResult = updatedResult ?? result;
        if (!requestFeedbackCompletionClosure(item, closureResult, record)) {
          setHandoffHintById((current) => ({ ...current, [item.id]: `${record.message} 已标记为 fixed。` }));
        }
      } else {
        setHandoffHintById((current) => ({ ...current, [item.id]: record.message }));
      }
    } catch (error) {
      setHandoffHintById((current) => ({ ...current, [item.id]: `Repair resolution feedback failed closed：${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  function requestFeedbackCompletionClosure(
    item: FeedbackCommentRecord,
    result?: FeedbackRepairResultRecord,
    action?: FeedbackRepairActionRecord,
  ) {
    const report = buildFeedbackRepairClosureReport(item, result, action);
    if (!item.githubIssueNumber) {
      onStatusChange([item.id], 'fixed');
      setHandoffHintById((current) => ({ ...current, [item.id]: '已标记为 fixed；这个反馈没有关联 GitHub Issue。' }));
      return false;
    }
    setPendingRepairClosure({
      issueId: item.id,
      result,
      report,
      githubIssueNumber: item.githubIssueNumber,
      githubIssueUrl: item.githubIssueUrl,
    });
    setHandoffHintById((current) => ({ ...current, [item.id]: `等待确认：将写入完成报告并关闭 GitHub Issue #${item.githubIssueNumber}。` }));
    return true;
  }

  async function closePendingRepairClosure(syncGithub: boolean) {
    const pending = pendingRepairClosure;
    if (!pending) return;
    const issueNumber = pending.githubIssueNumber;
    if (!syncGithub || !issueNumber) {
      onStatusChange([pending.issueId], 'fixed');
      setPendingRepairClosure(undefined);
      setHandoffHintById((current) => ({ ...current, [pending.issueId]: '已标记为 fixed；未同步 GitHub。' }));
      return;
    }
    const repo = effectiveGithubRepo;
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    if (!ensureGithubTokenOrOpenSettings()) return;
    const token = feedbackGithubToken?.trim();
    setGithubSubmitBusy(true);
    try {
      onStatusChange([pending.issueId], 'fixed');
      const synced = await syncFeedbackRepairClosure({
        repo,
        token,
        issueNumber,
        reportBody: pending.report,
        closeIssue: true,
      });
      const syncedAt = synced.updatedAt || nowIso();
      if (pending.result) {
        onRepairResultWritten({
          ...pending.result,
          githubSyncStatus: 'synced',
          githubSyncError: undefined,
          githubSyncedAt: syncedAt,
          githubCommentUrl: synced.commentUrl,
        });
      }
      onGithubIssueClosed([pending.issueId], {
        number: issueNumber,
        htmlUrl: synced.htmlUrl || pending.githubIssueUrl,
        commentUrl: synced.commentUrl,
        updatedAt: syncedAt,
      });
      setPendingRepairClosure(undefined);
      setGithubActionHint(`已评论并关闭 GitHub Issue #${issueNumber}。`);
      setHandoffHintById((current) => ({ ...current, [pending.issueId]: `已标记 fixed，并同步关闭 GitHub Issue #${issueNumber}。` }));
    } catch (error) {
      onGithubIssueSyncFailed([pending.issueId], error);
      if (pending.result) {
        onRepairResultWritten({
          ...pending.result,
          githubSyncStatus: 'failed',
          githubSyncError: error instanceof Error ? error.message : String(error),
          githubSyncedAt: nowIso(),
        });
      }
      setGithubActionHint(error instanceof Error ? error.message : String(error));
      setHandoffHintById((current) => ({ ...current, [pending.issueId]: '本地已标记 fixed；GitHub 同步失败，可修正配置后重试。' }));
    } finally {
      setGithubSubmitBusy(false);
    }
  }

  function createRequestFromSelectedFeedback() {
    onCreateRequest(selectedVisibleActiveComments.map((comment) => comment.id), requestTitleFromFeedback(selectedVisibleActiveComments));
    setQueueActionHint(`已从当前可见已选 ${selectedVisibleActiveComments.length} 条反馈生成本地 Request。`);
  }

  function exportFeedbackBundle() {
    exportJsonFile(`sciforge-feedback-${nowIso().slice(0, 10)}.json`, bundle);
    setQueueActionHint(`已导出 ${bundleScopeComments.length} 条反馈的 Bundle；范围为${selectedVisibleComments.length ? '当前可见已选' : '当前可见列表'}。`);
  }

  const selectedRepairBusy = Boolean(selectedRepairCandidate && handoffBusyById[selectedRepairCandidate.id]);

  return (
    <main className="feedback-page">
      <section className="feedback-hero">
        <div>
          <Badge variant="info">Feedback Bundle</Badge>
          <h1>反馈收件箱</h1>
          <p>汇总多用户页面评论、元素定位、证据完整性、修复线程和日志证据，作为 GitHub 同步与 Runtime Codex 修复交接面。</p>
        </div>
        <div className="feedback-stats">
          <span><strong>{activeComments.length}</strong> active</span>
          <span><strong>{comments.filter((item) => item.status === 'open').length}</strong> open</span>
          <span><strong>{githubSyncedOpenIssues.length}</strong> GitHub open</span>
          <span><strong>{statusCounts.blocked ?? 0}</strong> blocked</span>
        </div>
      </section>
      {pendingRepairAction ? (
        <section className="feedback-page-state" aria-label="repair git action confirmation">
          <div className="feedback-page-state-head">
            <div>
              <strong>{repairActionTitle(pendingRepairAction.action)}</strong>
              <span>{repairActionConfirmationCopy(pendingRepairAction.action, gitOperationMode)}</span>
            </div>
            <Badge variant={pendingRepairAction.action === 'merge' ? 'danger' : 'warning'}>
              {pendingRepairAction.action}
            </Badge>
          </div>
          {pendingRepairAction.safeModeActive ? (
            <label className="settings-check-row">
              <input
                type="checkbox"
                checked={repairActionSafeModeConfirmed}
                onChange={(event) => setRepairActionSafeModeConfirmed(event.target.checked)}
              />
              <span>Safe mode extra confirmation: {pendingRepairAction.safeModeDetail}</span>
            </label>
          ) : null}
          <div className="feedback-page-state-actions">
            <button type="button" onClick={() => setPendingRepairAction(undefined)}>取消</button>
            <button
              type="button"
              disabled={pendingRepairAction.safeModeActive && !repairActionSafeModeConfirmed}
              onClick={() => {
                const item = comments.find((candidate) => candidate.id === pendingRepairAction.issueId);
                if (!item) return;
                void executeRepairAction(item, pendingRepairAction.action, {
                  safeModeConfirmed: pendingRepairAction.safeModeActive ? repairActionSafeModeConfirmed : false,
                });
              }}
            >
              确认记录
            </button>
          </div>
        </section>
      ) : null}
      <FeedbackInboxToolbar
        activeCommentsLength={activeComments.length}
        allVisibleSelected={visibleSelectedCount === visibleIds.length}
        bulkStatus={bulkStatus}
        effectiveGithubRepo={effectiveGithubRepo}
        feedbackGithubToken={feedbackGithubToken}
        gitOperationMode={gitOperationMode}
        githubActionHint={githubActionHint}
        githubDryRun={githubDryRun}
        githubSubmitBusy={githubSubmitBusy}
        githubSyncBusy={githubSyncBusy}
        issueScopeCommentsLength={issueScopeComments.length}
        queueActionHint={queueActionHint}
        searchQuery={searchQuery}
        selectedDeletedCount={selectedDeletedIds.length}
        selectedRepairBusy={selectedRepairBusy}
        selectedRepairCandidateId={selectedRepairCandidate?.id}
        selectedVisibleActiveCount={selectedVisibleActiveComments.length}
        selectionSummary={selectionSummary}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        visibleIdsLength={visibleIds.length}
        onBulkStatusChange={setBulkStatus}
        onCreateRequest={createRequestFromSelectedFeedback}
        onExportBundle={exportFeedbackBundle}
        onGitOperationModeChange={setGitOperationMode}
        onMarkSelected={() => markSelected(bulkStatus)}
        onRepairSelected={() => selectedRepairCandidate && void handoffFeedbackIssue(selectedRepairCandidate)}
        onRequestGithubAction={requestGithubAction}
        onRestoreSelected={() => restoreSelected(selectedDeletedIds)}
        onSearchQueryChange={setSearchQuery}
        onSelectCurrentList={() => setSelectedIds(visibleIds)}
        onSoftDeleteSelected={() => requestSoftDeleteSelected(selectedVisibleActiveComments.map((comment) => comment.id))}
        onStatusFilterChange={setStatusFilter}
      />
      {pendingQueueAction ? (
        <FeedbackActionConfirmation
          actionsClassName="feedback-queue-confirmation-actions"
          ariaLabel="确认本地队列操作"
          className="feedback-queue-confirmation"
          confirmLabel={queueActionConfirmLabel(pendingQueueAction.kind)}
          gridClassName="feedback-queue-confirmation-grid"
          impact={queueActionImpact(pendingQueueAction.kind)}
          rows={[
            { label: 'Scope', value: pendingQueueAction.scopeLabel },
            { label: 'Local effect', value: queueActionDataLabel(pendingQueueAction) },
          ]}
          title={queueActionTitle(pendingQueueAction.kind)}
          onCancel={cancelPendingQueueAction}
          onConfirm={confirmPendingQueueAction}
        />
      ) : null}
      {pendingGithubAction ? (
        <FeedbackActionConfirmation
          actionsClassName="feedback-github-confirmation-actions"
          ariaLabel="确认 GitHub 外部操作"
          className="feedback-github-confirmation"
          confirmDisabled={githubSubmitBusy || githubSyncBusy || evidenceUploadBusy}
          confirmLabel={githubActionConfirmLabel(pendingGithubAction.kind)}
          gridClassName="feedback-github-confirmation-grid"
          impact={githubActionImpact(pendingGithubAction.kind)}
          rows={[
            { label: 'Destination', value: pendingGithubAction.repo },
            { label: 'Scope', value: pendingGithubAction.scopeLabel },
            { label: 'Data', value: githubActionDataLabel(pendingGithubAction) },
          ]}
          title={githubActionTitle(pendingGithubAction.kind)}
          onCancel={cancelPendingGithubAction}
          onConfirm={() => void confirmPendingGithubAction()}
        />
      ) : null}
      {pendingRepairClosure ? (
        <section className="feedback-repair-closure-confirmation" role="alertdialog" aria-label="确认修复闭环">
          <div className="feedback-repair-closure-head">
            <div>
              <Badge variant="success">resolved</Badge>
              <strong>确认解决并同步</strong>
              <p>系统已根据反馈、可用修复结果和用户确认生成简报。确认后会把本地反馈标记为 fixed，并在 GitHub Issue 写入简报后关闭。</p>
            </div>
            <Badge variant="info">{pendingRepairClosure.githubIssueNumber ? `#${pendingRepairClosure.githubIssueNumber}` : 'local'}</Badge>
          </div>
          <pre>{pendingRepairClosure.report}</pre>
          <div className="feedback-repair-closure-actions">
            <button type="button" onClick={() => void closePendingRepairClosure(true)} disabled={githubSubmitBusy}>
              {githubSubmitBusy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
              同步并关闭 Issue
            </button>
            <button type="button" onClick={() => void closePendingRepairClosure(false)} disabled={githubSubmitBusy}>
              只标记本地 fixed
            </button>
            <button type="button" onClick={() => setPendingRepairClosure(undefined)} disabled={githubSubmitBusy}>
              稍后
            </button>
          </div>
        </section>
      ) : null}
      {!visibleComments.length ? (
        <div className="empty-runtime-state">
          <Badge variant="muted">empty</Badge>
          {comments.length ? (
            <>
              <strong>没有匹配当前筛选或搜索的反馈</strong>
              <p>调整状态筛选、清空搜索，或点击「选择当前列表」前确认当前范围。隐藏选择不会参与当前操作。</p>
            </>
          ) : (
            <>
              <strong>还没有反馈</strong>
              <p>点击顶栏“注释”打开反馈侧栏：先说清楚问题，小改动可快捷处理，复杂改动进入收件箱。</p>
            </>
          )}
        </div>
      ) : (
        <section className="feedback-list">
          {visibleComments.map((item) => (
              <article className={cx('feedback-card', selectedIds.includes(item.id) && 'selected', item.status === 'deleted' && 'deleted')} key={item.id}>
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`选择反馈 ${item.id}`} />
                <div className="feedback-card-main">
                {(() => {
                  const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults, repairActions, repairGuidance);
                  const targetValue = handoffTargetById[item.id] || repairTargets[0]?.name || '';
                  const selectedTarget = repairTargets.find((peer) => peer.name === targetValue);
                  const runMetadata = isRecord(audit.latestRun?.metadata) ? audit.latestRun.metadata : undefined;
                  const resultMetadata = isRecord(audit.latestResult?.metadata) ? audit.latestResult.metadata : undefined;
                  const terminalWorkspacePath = firstNonEmptyString(
                    audit.latestResult?.targetInstance?.workspacePath,
                    stringField(resultMetadata?.targetWorkspacePath),
                    stringField(runMetadata?.targetWorkspacePath),
                    selectedTarget?.workspacePath,
                    config.workspacePath,
                  ) ?? config.workspacePath;
                  const evidence = feedbackEvidenceSummary(item);
                  const terminalInfo = feedbackCommentTerminalInfo(item);
                  const repairSummary = feedbackRepairCardSummary(audit);
                  const githubTrace = feedbackGithubTrace(item, githubSyncedOpenIssues);
                  const annotationPlan = feedbackAnnotationPlanMetadata(item);
                  const canUserCloseGithubIssue = Boolean(item.githubIssueNumber)
                    && item.githubIssueState !== 'closed'
                    && item.githubSyncStatus !== 'github-closed';
                  const isEditingComment = editingCommentId === item.id;
                  return (
                    <>
                <div className="feedback-card-head">
                  {isEditingComment ? (
                    <div className="feedback-comment-editor">
                      <textarea
                        aria-label={`反馈 ${item.id} 评论文本`}
                        value={editingCommentDraft}
                        onChange={(event) => setEditingCommentDraft(event.target.value)}
                        rows={3}
                      />
                      <div className="feedback-comment-editor-actions">
                        <button
                          type="button"
                          aria-label={`保存反馈 ${item.id}`}
                          title="保存评论"
                          onClick={() => {
                            onCommentEdit(item.id, editingCommentDraft);
                            setEditingCommentId(undefined);
                            setEditingCommentDraft('');
                          }}
                        >
                          <Save size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`取消编辑反馈 ${item.id}`}
                          title="取消编辑"
                          onClick={() => {
                            setEditingCommentId(undefined);
                            setEditingCommentDraft('');
                          }}
                        >
                          <X size={13} aria-hidden />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <strong>{item.comment || <span className="feedback-card-empty-comment">空评论</span>}</strong>
                  )}
                  <div className="feedback-card-head-actions">
                    {!isEditingComment && item.status !== 'deleted' ? (
                      <button
                        type="button"
                        className="feedback-comment-edit-button"
                        aria-label={`编辑反馈 ${item.id}`}
                        title="编辑评论"
                        onClick={() => {
                          setEditingCommentId(item.id);
                          setEditingCommentDraft(item.comment);
                        }}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                    ) : null}
                    <Badge variant={feedbackStatusVariant(item.status)}>{feedbackStatusLabel(item.status)}</Badge>
                    <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'warning' : 'muted'}>{item.priority}</Badge>
                    {annotationPlan ? <Badge variant="info">annotation-plan</Badge> : null}
                    <Badge variant={audit.badge}>{audit.label}</Badge>
                  </div>
                </div>
	                <p className="feedback-card-meta">
	                  {item.authorName} · {formatSessionTime(item.createdAt)} · {item.runtime.page}
	                  {item.deletedAt ? ` · soft-deleted ${formatSessionTime(item.deletedAt)}` : ''}
	                  {item.restoredAt ? ` · restored ${formatSessionTime(item.restoredAt)}` : ''}
	                </p>
	                {item.githubIssueUrl || canUserCloseGithubIssue ? (
                    <div className="feedback-github-card-actions">
                      {item.githubIssueUrl ? (
                        <a
                          className="feedback-github-card-link"
                          href={item.githubIssueUrl}
                          onClick={(event) => openGithubIssue(event, item.githubIssueUrl!)}
                          title="打开对应的 GitHub Issue"
                        >
                          GitHub #{item.githubIssueNumber ?? '?'}
                          <ExternalLink size={13} aria-hidden />
                        </a>
                      ) : null}
                      {canUserCloseGithubIssue ? (
                        <button
                          type="button"
                          onClick={() => requestFeedbackCompletionClosure(item, audit.latestResult)}
                          disabled={githubSubmitBusy}
                          title="用户确认完成后写入简报并关闭对应的 GitHub Issue"
                        >
                          <CheckCheck size={13} aria-hidden />
                          确认完成并关闭 Issue
                        </button>
                      ) : null}
                    </div>
	                ) : null}
	                <div className={cx('feedback-github-trace', githubTrace.tone)} aria-label="GitHub sync trace">
	                  <span>local <code>{item.id}</code></span>
	                  <span>sync <strong>{githubTrace.syncStatus}</strong></span>
	                  {githubTrace.issueLabel ? <span>issue <strong>{githubTrace.issueLabel}</strong></span> : null}
	                  {githubTrace.state ? <span>state <strong>{githubTrace.state}</strong></span> : null}
	                  {githubTrace.syncedAt ? <span>synced <strong>{formatSessionTime(githubTrace.syncedAt)}</strong></span> : null}
	                  {githubTrace.error ? <span className="danger">{githubTrace.error}</span> : null}
	                  {githubTrace.publicEvidenceRef ? <span>evidence <code>{githubTrace.publicEvidenceRef}</code></span> : null}
	                </div>
	                <div className="feedback-card-summary-strip">
	                  <span><strong>Evidence</strong> {evidence.ready}/{evidence.total} · {evidence.status}</span>
	                  <span><strong>Repair</strong> {audit.label}</span>
	                  <span><strong>Target</strong> {item.target.tagName || 'element'} · {item.runtime.scenarioId}</span>
                    {annotationPlan ? <span><strong>Intent</strong> {annotationPlan.referenceCount} refs · inbox audit ready</span> : null}
	                </div>
	                <div className={cx('feedback-card-repair-callout', repairSummary.tone)} aria-label="repair summary">
	                  <div>
	                    <strong>{repairSummary.title}</strong>
	                    <span>{repairSummary.detail}</span>
	                  </div>
	                  <span>{repairSummary.nextAction}</span>
	                </div>
	                {audit.latestResult ? (
	                  <FeedbackRepairResolutionComposer
	                    aria-label="repair result user closure"
	                    browserVerificationLabel={audit.latestBrowserVerificationLabel}
	                    busy={Boolean(handoffBusyById[item.id])}
	                    helpText="只需要确认这个问题是否已解决；仍有问题时再补充剩余现象。"
	                    placeholder="如果仍未解决，写下现在还存在的问题..."
	                    remainingProblem={remainingProblemById[item.id] ?? ''}
	                    remaining-problem-aria-label="记录修复后仍然存在的问题"
	                    remainingLabel="仍有问题"
	                    solvedLabel="问题已解决"
	                    onSolved={() => audit.latestResult && void recordRepairResolutionFeedback(item, audit.latestResult, 'solved')}
	                    onRemaining={() => audit.latestResult && void recordRepairResolutionFeedback(item, audit.latestResult, 'remaining')}
	                    onRemainingProblemChange={(value) => setRemainingProblemById((current) => ({ ...current, [item.id]: value }))}
	                  />
	                ) : null}
		                <FeedbackEvidenceReview item={item} config={config} />
	                <FeedbackCodexTerminalPanel
	                  config={config}
	                  item={item}
	                  providerReady={repairReadiness.providerReady === true}
	                  providerBlocker={repairReadiness.providerBlocker}
                    gitMode={gitOperationMode}
	                  onRepairRunWritten={onRepairRunWritten}
	                />
		                {feedbackShouldShowRepairAudit(audit, handoffHintById[item.id]) ? (
		                <details className="feedback-card-section feedback-card-audit-section" open={Boolean(handoffHintById[item.id] || audit.status === 'blocked')}>
		                  <summary>
		                    修复审计 · {audit.label}
		                  </summary>
	                  <FeedbackRepairAuditPanel
	                    audit={audit}
	                    repairTargets={repairTargets}
	                    targetValue={targetValue}
	                    busy={handoffBusyById[item.id]}
	                    hint={handoffHintById[item.id]}
	                    onTargetChange={(targetName) => setHandoffTargetById((current) => ({ ...current, [item.id]: targetName }))}
	                    onHandoff={(input) => void handoffFeedbackIssue(item, input)}
	                    onConfirmAction={(action) => void confirmRepairAction(item, action)}
	                    onLoadTerminalMirror={(input) => loadFeedbackRepairTerminalMirror(config, {
	                      terminalMirrorRef: input.terminalMirrorRef,
	                      cursor: input.cursor,
	                      limit: 200,
	                      workspacePath: terminalWorkspacePath,
	                    })}
	                    onStopRepair={async (input) => {
	                      const stop = await stopFeedbackRepairHandoff(config, {
	                        repairRunId: input.repairRunId,
	                        terminalMirrorRef: input.terminalMirrorRef,
	                        reason: 'feedback inbox stop button',
	                        workspacePath: terminalWorkspacePath,
	                      });
	                      if (!stop.stopped && stop.status === 'not-running' && audit.latestRun?.id === input.repairRunId) {
	                        const result = await persistBlockedRepairHandoffResult(item, {
	                          failureKind: 'runtime-codex-handoff-failed',
	                          message: stop.message,
	                          repairRun: audit.latestRun,
	                          target: selectedTarget,
	                        });
	                        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair stop 已写入阻断审计：${result.summary}` }));
	                      }
	                      return stop;
	                    }}
	                    onSendGuidance={async (input) => {
	                      const guidanceConfig = audit.latestResult ? repairActionConfigForResult(config, audit.latestResult, repairTargets) : config;
	                      const response = await sendFeedbackRepairGuidance(guidanceConfig, item.id, {
	                        repairRunId: input.repairRunId,
	                        repairResultId: input.repairResultId,
	                        terminalMirrorRef: input.terminalMirrorRef,
	                        message: input.message,
	                        workspacePath: guidanceConfig.workspacePath || terminalWorkspacePath,
	                      });
	                      onRepairGuidanceWritten(response.guidance);
	                      return response;
	                    }}
		                  />
		                </details>
		                ) : null}
	                <details className="feedback-card-section">
	                  <summary>定位、证据完整性与 refs</summary>
	                  <div className="feedback-target-summary compact">
	                    <span>target</span>
	                    <code>{item.target.selector}</code>
	                    <span>runtime</span>
	                    <code>{item.runtime.sessionId ?? 'no-session'} / {item.runtime.activeRunId ?? 'no-run'}</code>
	                    <span>local id</span>
	                    <code>{item.id}</code>
	                    <span>request</span>
	                    <code>{item.requestId ?? 'none'}</code>
	                    {terminalInfo ? (
	                      <>
	                        <span>terminal</span>
	                        <code>{terminalInfo}</code>
	                      </>
	                    ) : null}
	                  </div>
	                  <div className={cx('feedback-evidence-summary', evidence.status)}>
	                    <div className="feedback-evidence-summary-head">
	                      <strong>Evidence {evidence.ready}/{evidence.total}</strong>
	                      <Badge variant={evidence.status === 'complete' ? 'success' : evidence.status === 'partial' ? 'warning' : 'danger'}>
	                        {evidence.status}
	                      </Badge>
	                    </div>
	                    <div className="feedback-evidence-pills">
	                      {evidence.checks.map((check) => (
	                        <span className={cx(check.ok ? 'ok' : 'missing')} key={check.label}>
	                          {check.label}
	                        </span>
	                      ))}
	                    </div>
	                    {evidence.diagnostics.length ? (
	                      <p>{evidence.diagnostics.join(' · ')}</p>
	                    ) : null}
	                  </div>
	                  {item.tags.length ? <div className="feedback-tags">{item.tags.map((tag) => <code key={tag}>{tag}</code>)}</div> : null}
	                </details>
	                    </>
                  );
                })()}
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="feedback-github-panel" aria-label="GitHub 未关闭 Issue">
        <div className="feedback-github-panel-head">
          <h2>GitHub 未关闭 Issue</h2>
          <p>与上方本地反馈评论独立；仅同步仍打开的 Issue，Pull Request 会自动排除。数据保存在本机 workspace。</p>
        </div>
        {githubSyncedOpenIssues.length ? (
          <ul className="feedback-github-issue-list">
            {githubSyncedOpenIssues.map((issue) => (
              <li key={issue.number}>
                <div className="feedback-github-issue-row">
                  <a
                    className="feedback-github-issue-link"
                    href={issue.htmlUrl}
                    onClick={(event) => openGithubIssue(event, issue.htmlUrl)}
                    title="打开对应的 GitHub Issue"
                  >
                    <span className="feedback-github-issue-num">#{issue.number}</span>
                    <strong>{issue.title}</strong>
                    <ExternalLink size={14} aria-hidden className="feedback-github-issue-ext" />
                  </a>
                  <div className="feedback-github-issue-meta">
                    {issue.authorLogin ? <span>@{issue.authorLogin}</span> : null}
                    <span>更新 {formatSessionTime(issue.updatedAt)}</span>
                    <span>同步 {formatSessionTime(issue.syncedAt)}</span>
                  </div>
                  {issue.labels.length ? (
                    <div className="feedback-tags">{issue.labels.map((label) => <code key={label}>{label}</code>)}</div>
                  ) : null}
                  {issue.conflict && issue.conflict.status !== 'none' ? (
                    <div className="feedback-github-conflict" role="status">
                      <Badge variant="warning">{issue.conflict.status}</Badge>
                      <span>{issue.conflict.note ?? 'GitHub issue and local feedback diverged; local annotation was preserved.'}</span>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="feedback-github-empty">
            <Badge variant="muted">empty</Badge>
            <p>尚未同步。配置仓库与 Token 后点击「从 GitHub 同步」。</p>
          </div>
        )}
      </section>
    </main>
  );
}

function feedbackStatusCounts(comments: FeedbackCommentRecord[]): Partial<Record<FeedbackCommentStatus, number>> {
  return comments.reduce<Partial<Record<FeedbackCommentStatus, number>>>((counts, comment) => {
    counts[comment.status] = (counts[comment.status] ?? 0) + 1;
    return counts;
  }, {});
}

function feedbackRepairCardSummary(audit: FeedbackRepairAuditViewModel) {
  const resultMetadata = isRecord(audit.latestResult?.metadata) ? audit.latestResult.metadata : undefined;
  const runMetadata = isRecord(audit.latestRun?.metadata) ? audit.latestRun.metadata : undefined;
  const failureKind = stringField(resultMetadata?.failureKind) ?? stringField(runMetadata?.failureKind);
  const threadCount = audit.repairThreads.length;
  if (audit.status === 'not-started') {
    return {
      tone: 'idle',
      title: '尚未开始修复',
      detail: threadCount ? `已有 ${threadCount} 条历史线程；最新线程未开始。` : '这条反馈还没有 repair 线程。',
      nextAction: '选择这条反馈点“修复选中”，或在修复会话输入初始引导。',
    };
  }
  if (audit.status === 'fixed' || audit.latestResultVerdict === 'fixed') {
    return {
      tone: 'fixed',
      title: '修复已完成',
      detail: audit.summary ?? audit.headline,
      nextAction: audit.latestBrowserVerificationLabel ? '可确认解决并同步状态。' : '先记录 browser 复核，再确认解决。',
    };
  }
  if (audit.status === 'blocked' || audit.latestResultVerdict === 'failed' || audit.latestResultVerdict === 'wont-fix') {
    return {
      tone: 'blocked',
      title: '修复受阻',
      detail: failureKind ? `阻塞来源：${feedbackRepairFailureKindLabel(failureKind)}。` : (audit.summary ?? audit.headline),
      nextAction: audit.latestRun?.id ? '展开日志证据查看最近状态，补充引导会新开一条修复线程。' : '处理配置或环境阻塞后重新启动 direct repair。',
    };
  }
  if (audit.latestRunStatus === 'running' || ['assigned', 'analyzing', 'patching', 'testing'].includes(audit.status)) {
    return {
      tone: 'running',
      title: '修复进行中',
      detail: audit.executorInstance ? `${audit.executorInstance} 正在处理；${audit.label}` : audit.headline,
      nextAction: '在修复会话观察 Runtime Codex 行增长，也可以发送引导介入。',
    };
  }
  return {
    tone: 'attention',
    title: audit.needsHumanVerification ? '需要人工核验' : '修复需要跟进',
    detail: audit.summary ?? audit.headline,
    nextAction: '查看证据完整性和修复会话后继续处理。',
  };
}

function feedbackShouldShowRepairAudit(audit: FeedbackRepairAuditViewModel, hint?: string) {
  return Boolean(
    hint
    || audit.status === 'blocked'
    || audit.latestResultVerdict === 'failed'
    || audit.latestResultVerdict === 'wont-fix'
    || audit.needsHumanVerification
    || audit.missingTestEvidence
    || audit.actionHistory.length
    || audit.guidanceHistory.length,
  );
}

function feedbackRepairFailureKindLabel(kind: string) {
  return ({
    'no-repair-target': '没有可用 repair 实例',
    'provider-preflight': 'LLM provider 预检失败',
    'runtime-provider-preflight-blocked': 'LLM provider 预检失败',
    'runtime-codex-handoff-failed': 'Runtime Codex handoff 失败',
    'runtime-bridge': 'Runtime bridge 不可用',
    'workspace-connection': 'workspace writer 连接失败',
    'strict-acceptance': '严格验收未通过',
    'repair-peer-readiness-blocked': 'repair 实例同步未就绪',
    'missing-repair-peer': '没有配置 repair peer',
  } as Record<string, string>)[kind] ?? kind;
}

function feedbackStatusLabel(status: FeedbackCommentStatus) {
  return FEEDBACK_STATUS_FILTERS.find((option) => option.value === status)?.label ?? status;
}

function feedbackCommentMatchesSearch(item: FeedbackCommentRecord, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  const searchable = [
    item.id,
    item.comment,
    item.expectedBehavior,
    item.actualBehavior,
    item.requestId,
    item.githubIssueNumber ? `#${item.githubIssueNumber}` : '',
    item.githubIssueUrl,
    item.githubSyncStatus,
    item.githubSyncError,
    item.priority,
    item.status,
    item.authorName,
    item.runtime.page,
    item.runtime.scenarioId,
    item.runtime.sessionId,
    item.runtime.activeRunId,
    item.target.selector,
    item.target.path,
    item.target.text,
    item.target.ariaLabel,
    item.target.role,
    item.target.tagName,
    item.evidenceBundleRef,
    item.screenshotRef,
    item.rawScreenshotRef,
    item.annotatedScreenshotRef,
    ...(item.tags ?? []),
    ...(item.evidenceAssets ?? []).flatMap((asset) => [
      asset.id,
      asset.kind,
      asset.ref,
      asset.publicUrl,
      asset.markdownImageUrl,
      asset.githubMarkdownUrl,
      asset.uploadRef,
    ]),
  ];
  return searchable
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function feedbackGithubTrace(item: FeedbackCommentRecord, syncedIssues: GithubSyncedOpenIssueRecord[]) {
  const syncedIssue = typeof item.githubIssueNumber === 'number'
    ? syncedIssues.find((issue) => issue.number === item.githubIssueNumber)
    : undefined;
  const syncStatus = item.githubSyncStatus ?? (item.githubIssueNumber ? 'not-synced' : 'local-only');
  const state = item.githubIssueState ?? syncedIssue?.state ?? (item.githubIssueNumber ? 'unknown' : undefined);
  const syncedAt = item.githubSyncedAt ?? syncedIssue?.syncedAt;
  const error = item.githubSyncError ?? (syncedIssue?.conflict && syncedIssue.conflict.status !== 'none' ? syncedIssue.conflict.note : undefined);
  const publicEvidenceRef = publicEvidenceRefForFeedback(item);
  return {
    syncStatus,
    issueLabel: item.githubIssueNumber ? `#${item.githubIssueNumber}` : undefined,
    state,
    syncedAt,
    error,
    publicEvidenceRef,
    tone: syncStatus === 'failed' || syncStatus === 'conflict' || error ? 'warning' : syncStatus === 'github-closed' ? 'closed' : item.githubIssueNumber ? 'synced' : 'local',
  };
}

function publicEvidenceRefForFeedback(item: FeedbackCommentRecord) {
  const asset = (item.evidenceAssets ?? []).find((candidate) => {
    if (candidate.visibility === 'private' || candidate.localOnly === true || candidate.kind === 'raw-screenshot') return false;
    const ref = candidate.ref?.trim() ?? '';
    if (!ref || ref.startsWith('repair-evidence/private/') || ref.includes('/private/')) return false;
    return Boolean(candidate.githubMarkdownUrl || candidate.publicUrl || candidate.markdownImageUrl || ref.startsWith('repair-evidence/public/'));
  });
  return asset?.githubMarkdownUrl || asset?.publicUrl || asset?.markdownImageUrl || asset?.ref;
}

function githubActionTitle(kind: PendingGithubActionKind) {
  return ({
    'submit-issue': '确认创建 GitHub Issue',
    'sync-open-issues': '确认从 GitHub 同步',
  } as Record<PendingGithubActionKind, string>)[kind];
}

function githubActionImpact(kind: PendingGithubActionKind) {
  return ({
    'submit-issue': '会把结构化 issue body 和公开 evidence refs 发送到 GitHub；不会包含 raw data URL、secret 或本地 private evidence。',
    'sync-open-issues': '会使用配置的 token 调用 GitHub API 读取未关闭 Issue，只更新本地同步缓存和导入记录，不创建远端内容。',
  } as Record<PendingGithubActionKind, string>)[kind];
}

function githubActionConfirmLabel(kind: PendingGithubActionKind) {
  return ({
    'submit-issue': '确认提交 Issue',
    'sync-open-issues': '确认同步 GitHub',
  } as Record<PendingGithubActionKind, string>)[kind];
}

function githubActionCancelImpact(kind: PendingGithubActionKind) {
  return ({
    'submit-issue': '没有发送 token、issue payload 或 evidence。',
    'sync-open-issues': '没有向 GitHub 发起读取请求，也没有发送 token 或改动本地同步缓存。',
  } as Record<PendingGithubActionKind, string>)[kind];
}

function githubActionDataLabel(action: PendingGithubAction) {
  if (action.kind === 'sync-open-issues') return 'GitHub token for read-only issue sync; up to 500 open issues';
  return `${action.count} feedback item(s), issue markdown, public evidence refs, labels/assignees/milestone config`;
}

function queueActionTitle(kind: PendingQueueActionKind) {
  return ({
    'soft-delete': '确认软删除本地反馈',
  } as Record<PendingQueueActionKind, string>)[kind];
}

function queueActionImpact(kind: PendingQueueActionKind) {
  return ({
    'soft-delete': '只会把当前可见且已选的本地反馈标记为 deleted；不会删除 GitHub Issue、repair audit、workspace patch、repair log evidence 或截图原始证据。',
  } as Record<PendingQueueActionKind, string>)[kind];
}

function queueActionConfirmLabel(kind: PendingQueueActionKind) {
  return ({
    'soft-delete': '确认软删除',
  } as Record<PendingQueueActionKind, string>)[kind];
}

function queueActionDataLabel(action: PendingQueueAction) {
  if (action.kind === 'soft-delete') return `${action.count} local feedback status update(s); evidence and repair refs preserved`;
  return `${action.count} local feedback item(s)`;
}

function feedbackCommentTerminalInfo(item: FeedbackCommentRecord) {
  const extended = item as FeedbackCommentRecord & {
    terminalMirrorRef?: string;
    terminalRef?: string;
    terminalSessionId?: string;
  };
  const metadata = isRecord(item.metadata) ? item.metadata : undefined;
  return firstNonEmptyString(
    extended.terminalMirrorRef,
    extended.terminalRef,
    extended.terminalSessionId,
    stringField(metadata?.terminalMirrorRef),
    stringField(metadata?.terminalRef),
    stringField(metadata?.terminalSessionId),
  );
}

function feedbackEvidenceRefList(item: FeedbackCommentRecord) {
  return [
    item.evidenceBundleRef,
    ...(item.evidenceAssets ?? []).flatMap((asset) => [asset.ref, asset.markdownImageUrl, asset.githubMarkdownUrl, asset.publicUrl, asset.uploadRef]),
    item.screenshotRef,
    item.rawScreenshotRef,
    item.annotatedScreenshotRef,
    item.screenshot?.rawScreenshotRef,
    item.screenshot?.annotatedScreenshotRef,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function hasUploadableEvidenceAsset(item: FeedbackCommentRecord) {
  return Boolean(item.evidenceAssets?.some((asset) => asset.kind === 'scrubbed-annotated-screenshot' && asset.ref.startsWith('repair-evidence/public/')));
}

function repairActionConfigForResult(config: SciForgeConfig, result: FeedbackRepairResultRecord, repairTargets: PeerInstance[]): SciForgeConfig {
  const metadata = isRecord(result.metadata) ? result.metadata : undefined;
  const resultWriterUrl = firstNonEmptyString(
    result.targetInstance?.workspaceWriterUrl,
    stringField(metadata?.targetWorkspaceWriterUrl),
  );
  const resultWorkspacePath = firstNonEmptyString(
    result.targetInstance?.workspacePath,
    stringField(metadata?.targetWorkspacePath),
  );
  const matchingPeer = repairTargets.find((peer) => {
    return (resultWriterUrl && peer.workspaceWriterUrl === resultWriterUrl)
      || (resultWorkspacePath && peer.workspacePath === resultWorkspacePath)
      || (result.targetInstance?.name && peer.name === result.targetInstance.name);
  });
  const workspaceWriterBaseUrl = resultWriterUrl || matchingPeer?.workspaceWriterUrl || config.workspaceWriterBaseUrl;
  const workspacePath = resultWorkspacePath || matchingPeer?.workspacePath || config.workspacePath;
  return {
    ...config,
    workspaceWriterBaseUrl,
    workspacePath,
  };
}

function browserRecheckInputForResult(
  result: FeedbackRepairResultRecord,
  browserManifest: RuntimeCodexBrowserAcceptanceManifest | undefined,
): FeedbackRepairActionRecord['browserVerification'] | undefined {
  const passed = window.confirm('已在 Codex in-app browser 重新打开原问题路径并确认修复通过了吗？选择取消会记录为未通过。');
  const conclusion = window.prompt(
    '记录 browser recheck 结论（例如：原问题已消失，反馈数据和 repair audit 仍在）：',
    passed ? 'Codex in-app browser recheck passed for the original feedback path.' : 'Codex in-app browser recheck failed or remains inconclusive.',
  );
  if (conclusion === null) return undefined;
  const manifestEvidence = browserManifest?.evidence;
  const defaultEvidenceRefs = [
    browserManifest?.actualUrl,
    browserManifest?.providerPreflightRef,
    manifestEvidence?.screenshotPath,
    manifestEvidence?.domSnapshotPath,
    manifestEvidence?.notesPath,
    manifestEvidence?.runtimeAuditPath,
    result.diffRef,
    result.refs?.patchRef,
    ...(result.humanVerification?.evidenceRefs ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
  const evidenceInput = window.prompt(
    '输入 browser recheck evidence refs，用逗号分隔（URL、截图、manifest 或 artifact refs）：',
    defaultEvidenceRefs.join(', '),
  );
  if (evidenceInput === null) return undefined;
  const evidenceRefs = evidenceInput.split(',').map((value) => value.trim()).filter(Boolean);
  const canRecordPassed = passed && evidenceRefs.length > 0 && browserManifestSupportsPassedRecheck(browserManifest);
  return {
    status: canRecordPassed ? 'passed' : passed ? 'pending' : 'failed',
    verifier: 'codex-in-app-browser',
    reviewer: 'feedback-inbox',
    conclusion: conclusion.trim() || (passed ? 'Browser recheck passed.' : 'Browser recheck failed.'),
    evidenceRefs,
    verifiedAt: nowIso(),
    note: canRecordPassed
      ? 'Recorded from the feedback inbox repair audit after reopening the issue path in the Codex in-app browser.'
      : passed
        ? 'User reported a browser pass, but strict live browser acceptance evidence was missing or stale; recorded as pending.'
        : 'Recorded from the feedback inbox repair audit after reopening the issue path in the Codex in-app browser.',
  };
}

function repairResolutionVerificationForResult(
  result: FeedbackRepairResultRecord,
  browserManifest: RuntimeCodexBrowserAcceptanceManifest | undefined,
  resolution: 'solved' | 'remaining',
  remainingProblem: string,
): FeedbackRepairHumanVerification {
  const evidenceRefs = repairResolutionEvidenceRefs(result, browserManifest);
  if (resolution === 'remaining') {
    return {
      status: 'failed',
      verifier: 'feedback-inbox-user',
      reviewer: 'feedback-inbox',
      conclusion: remainingProblem,
      evidenceRefs,
      verifiedAt: nowIso(),
      note: 'Recorded from the Feedback Inbox after reviewing the repair result; remaining-problem feedback is the next repair input.',
    };
  }
  return {
    status: evidenceRefs.length && browserManifestSupportsPassedRecheck(browserManifest) ? 'passed' : 'pending',
    verifier: 'feedback-inbox-user',
    reviewer: 'feedback-inbox',
    conclusion: 'User confirmed the original feedback issue is solved after reviewing the repair result.',
    evidenceRefs,
    verifiedAt: nowIso(),
    note: evidenceRefs.length && browserManifestSupportsPassedRecheck(browserManifest)
      ? 'Recorded from the Feedback Inbox after a current Codex in-app browser acceptance pass.'
      : 'User confirmed solved in the Feedback Inbox; strict current browser evidence was missing or stale, so commit remains gated.',
  };
}

function repairResolutionEvidenceRefs(
  result: FeedbackRepairResultRecord,
  browserManifest: RuntimeCodexBrowserAcceptanceManifest | undefined,
) {
  const manifestEvidence = browserManifest?.evidence;
  return [
    browserManifest?.actualUrl,
    browserManifest?.providerPreflightRef,
    manifestEvidence?.screenshotPath,
    manifestEvidence?.domSnapshotPath,
    manifestEvidence?.notesPath,
    manifestEvidence?.runtimeAuditPath,
    result.diffRef,
    result.refs?.patchRef,
    ...(result.humanVerification?.evidenceRefs ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function browserManifestSupportsPassedRecheck(manifest: RuntimeCodexBrowserAcceptanceManifest | undefined) {
  if (!manifest) return false;
  if (manifest.status !== 'passed'
    || manifest.acceptanceConclusionFromRealBrowser !== true
    || manifest.currentRunEvidenceScope !== 'live-browser-current-run'
    || manifest.startedFromDefaultChatEntry !== true
    || manifest.submittedThroughRuntimeCodex !== true) {
    return false;
  }
  if (manifest.freshness) {
    return manifest.freshness.observedAtFresh === true && manifest.freshness.evidenceFresh === true;
  }
  if (!manifest.observedAt) return false;
  const observedAtMs = Date.parse(manifest.observedAt);
  return Number.isFinite(observedAtMs)
    && observedAtMs <= Date.now() + 5 * 60 * 1000
    && observedAtMs >= Date.now() - 30 * 60 * 1000;
}

function repairActionTitle(action: FeedbackRepairActionRecord['action']) {
  if (action === 'commit') return '确认本地 commit';
  if (action === 'push') return '确认 push 审计';
  if (action === 'pr') return '确认 PR 审计';
  if (action === 'merge') return '确认 merge 拒绝审计';
  return '确认 repair action';
}

function repairActionConfirmationCopy(action: FeedbackRepairActionRecord['action'], mode: FeedbackGitOperationMode) {
  const modeText = mode === 'auto' ? '自动操作模式已选择，但分级确认仍然生效。' : '手动 git 操作是默认模式。';
  if (action === 'merge') return `${modeText} Merge 不会静默执行；这里只记录一次被拒绝的 merge 尝试审计。`;
  if (action === 'commit') return `${modeText} Commit 只允许在隔离 repair worktree 中创建本地提交，不会 push、PR 或 merge。`;
  if (action === 'push') return `${modeText} Push 需要第二次单独确认；当前控制面只记录 no-op 审计。`;
  if (action === 'pr') return `${modeText} PR 需要第二次单独确认；当前控制面只记录 no-op 审计。`;
  return modeText;
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function feedbackAnnotationPlanMetadata(item: FeedbackCommentRecord) {
  const metadata = isRecord(item.metadata) ? item.metadata : undefined;
  if (metadata?.source !== ANNOTATION_PLAN_SOURCE) return undefined;
  const annotationPlan = isRecord(metadata.annotationPlan) ? metadata.annotationPlan : {};
  const references = Array.isArray(annotationPlan.references) ? annotationPlan.references : [];
  return {
    referenceCount: references.length,
    planState: stringField(annotationPlan.planState) ?? 'draft-ready',
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
