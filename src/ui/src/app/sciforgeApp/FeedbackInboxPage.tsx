import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ArchiveRestore, CheckCheck, ExternalLink, GitBranch, Loader2, Trash2, UploadCloud } from 'lucide-react';
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
import { buildFeedbackBundle, buildFeedbackGithubIssueBody, buildFeedbackGithubIssueTitle, submitFeedbackGithubIssue, syncFeedbackGithubIssues } from '../../feedback/githubFeedback';
import { feedbackRepairAuditForIssue } from '../../feedback/feedbackWorkspace';
import { FeedbackRepairAuditPanel, repairSafeMode } from '../../feedback/FeedbackRepairAuditPanel';
import { FeedbackScreenshotPreview } from '../../feedback/FeedbackScreenshotPreview';
import { makeId, nowIso, type FeedbackCommentRecord, type FeedbackCommentStatus, type FeedbackRepairActionRecord, type FeedbackRepairGuidanceRecord, type FeedbackRepairResultRecord, type FeedbackRepairRunRecord, type GithubSyncedOpenIssueRecord, type PeerInstance, type RuntimeCodexBrowserAcceptanceManifest, type RuntimeProviderPreflightManifest, type SciForgeConfig, type SciForgeWorkspaceState, type SciForgeWorkspaceWriterHealth } from '../../domain';
import { DelayedHelpButton } from '../DelayedHelpButton';
import { exportJsonFile } from '../exportUtils';
import { APP_BUILD_ID, feedbackStatusVariant, formatSessionTime, requestTitleFromFeedback } from '../appShell/appHelpers';
import { Badge, cx } from '../uiPrimitives';
import { buildBlockedRepairHandoffResultInput, DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY, type RepairBlockedFailureKind } from './feedbackBlockedRepairResult';
import { repairPeerReadinessFromProbe, repairReadinessSummary, workspaceWriterReadinessRows, type RepairPeerReadinessByName, type RepairPeerReadinessProbe } from './feedbackRepairReadiness';

type FeedbackStatusFilter = FeedbackCommentStatus | 'all';

const FEEDBACK_STATUS_FILTERS: Array<{ value: FeedbackStatusFilter; label: string }> = [
  { value: 'all', label: '全部未删除' },
  { value: 'comment', label: 'comment' },
  { value: 'request', label: 'request' },
  { value: 'open', label: 'open' },
  { value: 'github-open', label: 'GitHub open' },
  { value: 'triaged', label: 'triaged' },
  { value: 'planned', label: 'planned' },
  { value: 'fixed', label: 'fixed' },
  { value: 'blocked', label: 'blocked' },
  { value: 'needs-discussion', label: 'needs-discussion' },
  { value: 'wont-fix', label: 'wont-fix' },
  { value: 'deleted', label: 'deleted' },
];

const BULK_STATUS_OPTIONS: Array<{ value: FeedbackCommentStatus; label: string }> = [
  { value: 'comment', label: 'comment' },
  { value: 'request', label: 'request' },
  { value: 'open', label: 'open' },
  { value: 'github-open', label: 'GitHub open' },
  { value: 'triaged', label: 'triaged' },
  { value: 'planned', label: 'planned' },
  { value: 'fixed', label: 'fixed' },
  { value: 'blocked', label: 'blocked' },
  { value: 'needs-discussion', label: 'needs-discussion' },
  { value: 'wont-fix', label: 'wont-fix' },
];

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
  onOpenGithubSettings: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>('all');
  const [bulkStatus, setBulkStatus] = useState<FeedbackCommentStatus>('triaged');
  const [githubActionHint, setGithubActionHint] = useState('');
  const [githubSubmitBusy, setGithubSubmitBusy] = useState(false);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [evidenceUploadBusy, setEvidenceUploadBusy] = useState(false);
  const [handoffBusyById, setHandoffBusyById] = useState<Record<string, boolean>>({});
  const [handoffTargetById, setHandoffTargetById] = useState<Record<string, string>>({});
  const [handoffHintById, setHandoffHintById] = useState<Record<string, string>>({});
  const [runtimePreflightManifest, setRuntimePreflightManifest] = useState<RuntimeProviderPreflightManifest | undefined>();
  const [runtimePreflightError, setRuntimePreflightError] = useState('');
  const [browserAcceptanceManifest, setBrowserAcceptanceManifest] = useState<RuntimeCodexBrowserAcceptanceManifest | undefined>();
  const [browserAcceptanceError, setBrowserAcceptanceError] = useState('');
  const [workspaceWriterHealth, setWorkspaceWriterHealth] = useState<SciForgeWorkspaceWriterHealth | undefined>();
  const [workspaceWriterHealthError, setWorkspaceWriterHealthError] = useState('');
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
  const repairTargets = useMemo(
    () => (config.peerInstances ?? []).filter((peer) => peer.enabled && peer.trustLevel === 'repair'),
    [config.peerInstances],
  );
  const repairTargetProbeKey = useMemo(
    () => repairTargets.map((peer) => `${peer.name}|${peer.workspaceWriterUrl}|${peer.workspacePath}`).join('||'),
    [repairTargets],
  );
  const [peerReadinessByName, setPeerReadinessByName] = useState<RepairPeerReadinessByName>({});
  const repairReadiness = useMemo(
    () => repairReadinessSummary(config.peerInstances ?? [], repairTargets, runtimePreflightManifest, runtimePreflightError, browserAcceptanceManifest, browserAcceptanceError, peerReadinessByName),
    [browserAcceptanceError, browserAcceptanceManifest, config.peerInstances, peerReadinessByName, repairTargets, runtimePreflightError, runtimePreflightManifest],
  );
  const writerReadinessRows = useMemo(
    () => workspaceWriterReadinessRows(workspaceWriterHealth, workspaceWriterHealthError),
    [workspaceWriterHealth, workspaceWriterHealthError],
  );
  const statusCounts = useMemo(() => feedbackStatusCounts(comments), [comments]);
  const activeComments = comments.filter((comment) => comment.status !== 'deleted');
  const visibleComments = comments
    .filter((comment) => statusFilter === 'all' ? comment.status !== 'deleted' : comment.status === statusFilter)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const selectedComments = comments.filter((comment) => selectedIds.includes(comment.id));
  const selectedActiveComments = selectedComments.filter((comment) => comment.status !== 'deleted');
  const selectedDeletedIds = selectedComments.filter((comment) => comment.status === 'deleted').map((comment) => comment.id);
  const bundle = buildFeedbackBundle(selectedComments.length ? selectedComments : visibleComments, requests, APP_BUILD_ID);
  const issueScopeComments = selectedActiveComments.length ? selectedActiveComments : visibleComments.filter((comment) => comment.status !== 'deleted');
  const issueTitle = buildFeedbackGithubIssueTitle(issueScopeComments);
  const issueBody = buildFeedbackGithubIssueBody(issueScopeComments, requests, APP_BUILD_ID);
  const visibleIds = visibleComments.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;

  useEffect(() => {
    let cancelled = false;
    setRuntimePreflightError('');
    setBrowserAcceptanceError('');
    setWorkspaceWriterHealthError('');
    setWorkspaceWriterHealth(undefined);
    loadWorkspaceWriterHealth(config).then((health) => {
      if (!cancelled) setWorkspaceWriterHealth(health);
    }).catch((error) => {
      if (cancelled) return;
      setWorkspaceWriterHealth(undefined);
      setWorkspaceWriterHealthError(error instanceof Error ? error.message : String(error));
    });
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
    if (!repairTargets.length) {
      setPeerReadinessByName({});
      return () => {
        cancelled = true;
      };
    }
    setPeerReadinessByName(Object.fromEntries(repairTargets.map((peer) => [peer.name, {
      peerName: peer.name,
      status: 'checking' as const,
      checkedAt: nowIso(),
      diagnostics: ['Checking peer writer health and instance manifest.'],
    }])));
    Promise.all(repairTargets.map(async (peer) => {
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
  }, [repairTargetProbeKey]);

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

  async function uploadSelectedEvidence() {
    const targetComments = issueScopeComments;
    if (!targetComments.length) return;
    setEvidenceUploadBusy(true);
    try {
      await uploadEvidenceForComments(targetComments, 'manual');
    } finally {
      setEvidenceUploadBusy(false);
    }
  }

  async function submitGithubIssueApi() {
    if (!issueScopeComments.length) return;
    if (!githubDryRun && !ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken?.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSubmitBusy(true);
    const submittedIds = issueScopeComments.map((comment) => comment.id);
    if (!githubDryRun) onGithubIssueSyncPending(submittedIds);
    try {
      const uploadedScopeComments = githubDryRun
        ? issueScopeComments
        : await uploadEvidenceForComments(issueScopeComments, 'github-submit');
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
    const ids = selectedActiveComments.map((comment) => comment.id);
    if (!ids.length) return;
    onStatusChange(ids, status);
  }

  function softDeleteSelected(ids: string[]) {
    if (!ids.length) return;
    const confirmed = window.confirm(`确认软删除 ${ids.length} 条本地反馈？GitHub Issue、repair audit、patch 和截图证据不会被删除。`);
    if (!confirmed) return;
    onDelete(ids);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
  }

  function restoreSelected(ids: string[]) {
    if (!ids.length) return;
    onRestore(ids);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
  }

  function openGithubIssue(event: ReactMouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    if (!url.trim()) return;
    window.location.assign(url);
  }

  async function handoffFeedbackIssue(item: FeedbackCommentRecord) {
    const targetName = handoffTargetById[item.id] || repairTargets[0]?.name || '';
    const target = repairTargets.find((peer) => peer.name === targetName);
    const selectedPeerReadiness = target ? peerReadinessByName[target.name] : undefined;
    if (target && repairReadiness.providerReady !== true) {
      setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
      try {
        const result = await persistBlockedRepairHandoffResult(item, {
          failureKind: 'runtime-provider-preflight-blocked',
          message: repairReadiness.providerBlocker,
          target,
        });
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit written: ${result.summary}` }));
      } catch (error) {
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit write failed：${error instanceof Error ? error.message : String(error)}` }));
      } finally {
        setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
      }
      return;
    }
    if (target && selectedPeerReadiness?.status !== 'ready') {
      setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
      try {
        const result = await persistBlockedRepairHandoffResult(item, {
          failureKind: 'repair-peer-readiness-blocked',
          message: selectedPeerReadiness
            ? selectedPeerReadiness.diagnostics.join('; ')
            : `Repair peer ${target.name} has not completed live health and manifest readiness checks.`,
          target,
          peerReadiness: selectedPeerReadiness,
        });
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit written: ${result.summary}` }));
      } catch (error) {
        setHandoffHintById((current) => ({ ...current, [item.id]: `Repair blocked audit write failed：${error instanceof Error ? error.message : String(error)}` }));
      } finally {
        setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
      }
      return;
    }
    if (!target) {
      setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
      try {
        const result = await persistBlockedRepairHandoffResult(item, {
          failureKind: 'missing-repair-peer',
          message: '没有可用的 repair 目标实例。请先配置 enabled + repair trust 的 peer instance。',
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
    setHandoffHintById((current) => ({ ...current, [item.id]: `正在准备交给 ${target.name}...` }));
    try {
      const executorManifestPromise = loadSciForgeInstanceManifest(config, config.workspacePath).catch(() => undefined);
      const [bundle, manifestResult, executorManifest] = await Promise.all([
        loadFeedbackIssueHandoffBundle(config, item.id),
        loadSciForgeInstanceManifest(targetConfig, target.workspacePath).then((value) => ({ status: 'fulfilled' as const, value })).catch((reason) => ({ status: 'rejected' as const, reason })),
        executorManifestPromise,
      ]);
      const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : undefined;
      const executorName = manifest?.instance.name || target.name;
      const executorId = manifest?.instance.id || target.name;
      const repairRunId = makeId('feedback-repair-run');
      const terminalMirrorRef = repairTerminalMirrorRef(target.workspacePath, repairRunId);
      const run: FeedbackRepairRunRecord = {
        schemaVersion: 1,
        id: repairRunId,
        issueId: item.id,
        status: 'running',
        externalInstanceId: executorId,
        externalInstanceName: executorName,
        actor: 'runtime-codex-repair-handoff',
        startedAt: nowIso(),
        note: `Runtime Codex repair handoff started for ${executorName}; commit/push/PR/merge remain disabled without explicit confirmation.`,
        terminalMirrorRef,
        planRef: `${target.workspacePath.replace(/\/+$/, '')}/.sciforge/repair-results/${repairRunId}/repair-request-plan.json`,
        confirmationPolicy: DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY,
        metadata: {
          handoffKind: 'feedback-repair',
          executorBackend: 'runtime-codex',
          terminalMirrorRef,
          runtimeProfile: config.runtimeProfile || defaultSciForgeConfig.runtimeProfile,
          allowOpenAiRuntime: config.allowOpenAiRuntime === true,
          sourceWorkspacePath: config.workspacePath || bundle?.workspacePath,
          targetWorkspacePath: target.workspacePath,
          targetAppUrl: target.appUrl,
          targetWorkspaceWriterUrl: target.workspaceWriterUrl,
          handoffBundle: bundle,
          targetManifest: manifest,
          targetManifestUnavailable: manifestResult.status === 'rejected' ? String(manifestResult.reason) : undefined,
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
          workspaceWriterUrl: target.workspaceWriterUrl,
          workspacePath: target.workspacePath,
        },
        targetWorkspacePath: target.workspacePath,
        targetWorkspaceWriterUrl: target.workspaceWriterUrl,
        issueBundle: bundle,
        expectedTests: DEFAULT_FEEDBACK_REPAIR_TESTS,
        githubSyncRequired: Boolean(item.githubIssueUrl || item.githubIssueNumber),
        repairRunId,
        executorBackend: 'runtime-codex',
        runtimeProfile: config.runtimeProfile || defaultSciForgeConfig.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        allowedWritePaths: DEFAULT_FEEDBACK_ALLOWED_WRITE_PATHS,
        forbiddenWritePaths: DEFAULT_FEEDBACK_FORBIDDEN_WRITE_PATHS,
        requestMetadata: {
          source: 'feedback-inbox',
          feedbackId: item.id,
          requestId: item.requestId,
          evidenceRefs: feedbackEvidenceRefList(item),
          targetWorkspacePath: target.workspacePath,
        },
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
      }).catch(() => undefined);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Runtime Codex repair handoff failed closed：${message}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  async function persistBlockedRepairHandoffResult(
    item: FeedbackCommentRecord,
    input: {
      failureKind: RepairBlockedFailureKind;
      message: string;
      repairRun?: FeedbackRepairRunRecord;
      target?: PeerInstance;
      peerReadiness?: RepairPeerReadinessProbe;
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
    }));
    onRepairResultWritten(result);
    return result;
  }

  async function confirmRepairAction(item: FeedbackCommentRecord, action: FeedbackRepairActionRecord['action']) {
    const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults, repairActions, repairGuidance);
    const result = audit.latestResult;
    if (!result) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '没有可确认的 repair result；请先完成 repair handoff。' }));
      return;
    }
    const safeMode = repairSafeMode(audit);
    let safeModeConfirmed = false;
    let browserVerification: FeedbackRepairActionRecord['browserVerification'];
    if (action === 'merge') {
      const confirmed = window.confirm('merge 永远不能自动执行；确定要记录一次被拒绝的 merge 尝试审计吗？');
      if (!confirmed) return;
    } else if (action === 'commit') {
      const confirmed = window.confirm('确认只在隔离 repair worktree 中创建本地 commit？不会 push、PR 或 merge。');
      if (!confirmed) return;
    } else if (action === 'browser-recheck') {
      browserVerification = browserRecheckInputForResult(result, browserAcceptanceManifest);
      if (!browserVerification) return;
    } else {
      const confirmed = window.confirm(`${action.toUpperCase()} 需要第二次单独确认；当前控制面只会记录 no-op 审计，不会真实 ${action === 'push' ? 'push' : '创建 PR'}。`);
      if (!confirmed) return;
    }
    if (safeMode.active && action !== 'merge' && action !== 'browser-recheck') {
      safeModeConfirmed = window.confirm(`Safe mode active：该 repair 触及反馈收件箱或 repair backend/control surface（${safeMode.matchedPaths.join(', ') || 'control surface metadata'}）。继续记录 ${action} 确认需要额外确认；更安全的路径是外部控制面复核。`);
      if (!safeModeConfirmed) return;
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
        safeModeConfirmed,
        browserVerification,
      }, actionConfig.workspacePath);
      onRepairActionWritten(record);
      if (updatedResult) onRepairResultWritten(updatedResult);
      setHandoffHintById((current) => ({ ...current, [item.id]: record.message }));
    } catch (error) {
      setHandoffHintById((current) => ({ ...current, [item.id]: `Repair ${action} failed closed：${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  return (
    <main className="feedback-page">
      <section className="feedback-hero">
        <div>
          <Badge variant="info">Feedback Bundle</Badge>
          <h1>反馈收件箱</h1>
          <p>汇总多用户页面评论、元素定位、证据完整性和 repair terminal mirror，作为 GitHub 同步与 Codex CLI 修复交接面。</p>
        </div>
        <div className="feedback-stats">
          <span><strong>{activeComments.length}</strong> active</span>
          <span><strong>{statusCounts.comment ?? 0}</strong> comment</span>
          <span><strong>{statusCounts.request ?? 0}</strong> request</span>
          <span><strong>{requests.length}</strong> requests</span>
          <span><strong>{comments.filter((item) => item.status === 'open').length}</strong> open</span>
          <span><strong>{githubSyncedOpenIssues.length}</strong> GitHub open</span>
          <span><strong>{statusCounts.blocked ?? 0}</strong> blocked</span>
          <span><strong>{statusCounts.deleted ?? 0}</strong> deleted</span>
        </div>
      </section>
      <section className={cx('feedback-repair-readiness', repairReadiness.status)} aria-label="Repair readiness">
        <div className="feedback-repair-readiness-head">
          <div>
            <strong>DeepSeek repair readiness</strong>
            <span>{repairReadiness.summary}</span>
          </div>
          <Badge variant={repairReadiness.status === 'ready' ? 'success' : repairReadiness.status === 'partial' ? 'warning' : 'danger'}>
            {repairReadiness.status}
          </Badge>
        </div>
        <div className="feedback-repair-readiness-grid">
          {[...writerReadinessRows, ...repairReadiness.rows].map((row) => (
            <div className={cx('feedback-repair-readiness-row', row.state)} key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              {row.detail ? <code>{row.detail}</code> : null}
            </div>
          ))}
        </div>
        {repairReadiness.nextAction ? (
          <div className="feedback-repair-readiness-action">
            <code>{repairReadiness.nextAction}</code>
            {repairReadiness.needsPeerSettings ? (
              <DelayedHelpButton onClick={onOpenGithubSettings} help="打开设置，添加 enabled + repair trust 的 peer instance。">
                打开设置
              </DelayedHelpButton>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="feedback-toolbar">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FeedbackStatusFilter)} aria-label="按反馈状态筛选">
          {FEEDBACK_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.value === 'all' ? activeComments.length : statusCounts[option.value] ?? 0})
            </option>
          ))}
        </select>
        <span className="feedback-selection-count">{selectedIds.length ? `已选择 ${selectedIds.length} 条` : `当前列表 ${visibleComments.length} 条`}</span>
        <DelayedHelpButton
          onClick={() => setSelectedIds(visibleIds)}
          disabled={!visibleIds.length || visibleSelectedCount === visibleIds.length}
          help="选择当前筛选结果中的所有反馈，适合批量标记、生成 Request 或提交到 GitHub。"
        >
          选择当前列表
        </DelayedHelpButton>
        <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as FeedbackCommentStatus)} aria-label="批量标记状态">
          {BULK_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <DelayedHelpButton
          onClick={() => markSelected(bulkStatus)}
          disabled={!selectedActiveComments.length}
          help="把已选反馈批量标记为下拉框中的共享状态；不会创建本地私有状态。"
        >
          <CheckCheck size={14} aria-hidden />
          批量标记
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => restoreSelected(selectedDeletedIds)}
          disabled={!selectedDeletedIds.length}
          help="把已软删除的反馈恢复为 open；不会改动 GitHub Issue、repair audit、patch 或截图证据。"
        >
          <ArchiveRestore size={14} aria-hidden />
          恢复选中
        </DelayedHelpButton>
        <DelayedHelpButton
          className="danger"
          onClick={() => softDeleteSelected(selectedActiveComments.map((comment) => comment.id))}
          disabled={!selectedActiveComments.length}
          help="软删除已选本地反馈；不会删除 GitHub Issue、repair audit、workspace patch 或截图原始证据。"
        >
          <Trash2 size={14} aria-hidden />
          软删除
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onCreateRequest(selectedActiveComments.map((comment) => comment.id), requestTitleFromFeedback(selectedActiveComments))}
          disabled={!selectedActiveComments.length}
          help="把已选反馈合并成一个本地 Request，便于后续按任务追踪。"
        >
          <GitBranch size={14} aria-hidden />
          生成 Request
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => exportJsonFile(`sciforge-feedback-${nowIso().slice(0, 10)}.json`, bundle)}
          help="导出当前选择或当前列表的反馈 Bundle，供离线归档或交给 Codex 批量处理。"
        >
          导出 Bundle
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => void uploadSelectedEvidence()}
          disabled={!issueScopeComments.some(hasUploadableEvidenceAsset) || evidenceUploadBusy}
          help="把已选反馈的 scrubbed screenshot 从 repair-evidence/public 上传到 GitHub Contents 或 writer 配置的对象存储，并回写公开 URL。"
        >
          {evidenceUploadBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : <UploadCloud size={14} aria-hidden />}
          上传 Evidence
        </DelayedHelpButton>
        <DelayedHelpButton
          className="feedback-github-primary"
          onClick={() => void submitGithubIssueApi()}
          disabled={!issueScopeComments.length || githubSubmitBusy}
          help={githubDryRun
            ? `Dry-run：生成 ${effectiveGithubRepo || '配置仓库'} Issue payload，不调用 GitHub API，也不改本地 GitHub-open 状态。`
            : `向 ${effectiveGithubRepo || '配置仓库'} 创建 GitHub Issue；需要在设置中填写具备 Issues 读写权限的 PAT。`}
        >
          {githubSubmitBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
          {githubDryRun ? 'Dry-run GitHub' : '提交到 GitHub'}
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => void syncGithubOpenIssues()}
          disabled={githubSyncBusy}
          help={`从 ${effectiveGithubRepo || '配置仓库'} 拉取未关闭 Issue，并导入为本地反馈；Pull Request 会自动排除。`}
        >
          {githubSyncBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
          从 GitHub 同步
        </DelayedHelpButton>
        {!feedbackGithubToken?.trim() ? (
          <span className="feedback-toolbar-token-note" title="GitHub API 匿名不可用">
            未配置 Token：点「提交 / 同步」将打开设置并提示填写 PAT
          </span>
        ) : null}
        {githubActionHint ? <span className="feedback-github-hint" role="status">{githubActionHint}</span> : null}
      </section>
      {!visibleComments.length ? (
        <div className="empty-runtime-state">
          <Badge variant="muted">empty</Badge>
          <strong>还没有反馈</strong>
          <p>点击右下角“评论”进入评论模式，然后点选任意页面元素保存反馈。</p>
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
                  return (
                    <>
                <div className="feedback-card-head">
                  <strong>{item.comment}</strong>
                  <div className="feedback-card-head-actions">
                    <Badge variant={feedbackStatusVariant(item.status)}>{feedbackStatusLabel(item.status)}</Badge>
                    <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'warning' : 'muted'}>{item.priority}</Badge>
                    <Badge variant={audit.badge}>{audit.label}</Badge>
                  </div>
                </div>
	                <p className="feedback-card-meta">
	                  {item.authorName} · {formatSessionTime(item.createdAt)} · {item.runtime.page}
	                  {item.deletedAt ? ` · soft-deleted ${formatSessionTime(item.deletedAt)}` : ''}
	                  {item.restoredAt ? ` · restored ${formatSessionTime(item.restoredAt)}` : ''}
	                </p>
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
	                <div className="feedback-card-summary-strip">
	                  <span><strong>Evidence</strong> {evidence.ready}/{evidence.total} · {evidence.status}</span>
	                  <span><strong>Repair</strong> {audit.label}</span>
	                  <span><strong>Target</strong> {item.target.tagName || 'element'} · {item.runtime.scenarioId}</span>
	                </div>
	                <FeedbackScreenshotPreview item={item} config={config} />
	                {(item.expectedBehavior || item.actualBehavior) ? (
	                  <details className="feedback-card-section">
	                    <summary>期望与实际</summary>
	                    <div className="feedback-behavior-grid">
	                      {item.expectedBehavior ? (
	                        <>
	                          <span>expected</span>
	                          <p>{item.expectedBehavior}</p>
	                        </>
	                      ) : null}
	                      {item.actualBehavior ? (
	                        <>
	                          <span>actual</span>
	                          <p>{item.actualBehavior}</p>
	                        </>
	                      ) : null}
	                    </div>
	                  </details>
	                ) : null}
	                <details className="feedback-card-section">
	                  <summary>Repair 交接与终端</summary>
	                  <FeedbackRepairAuditPanel
	                    audit={audit}
	                    repairTargets={repairTargets}
	                    targetValue={targetValue}
	                    busy={handoffBusyById[item.id]}
	                    hint={handoffHintById[item.id]}
	                    onTargetChange={(targetName) => setHandoffTargetById((current) => ({ ...current, [item.id]: targetName }))}
	                    onHandoff={() => void handoffFeedbackIssue(item)}
	                    onConfirmAction={(action) => void confirmRepairAction(item, action)}
	                    onLoadTerminalMirror={(input) => loadFeedbackRepairTerminalMirror(config, {
	                      terminalMirrorRef: input.terminalMirrorRef,
	                      cursor: input.cursor,
	                      limit: 200,
	                      workspacePath: terminalWorkspacePath,
	                    })}
	                    onStopRepair={(input) => stopFeedbackRepairHandoff(config, {
	                      repairRunId: input.repairRunId,
	                      terminalMirrorRef: input.terminalMirrorRef,
	                      reason: 'feedback inbox stop button',
	                      workspacePath: terminalWorkspacePath,
	                    })}
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

function feedbackStatusLabel(status: FeedbackCommentStatus) {
  return FEEDBACK_STATUS_FILTERS.find((option) => option.value === status)?.label ?? status;
}

function feedbackEvidenceSummary(item: FeedbackCommentRecord) {
  const checks = [
    {
      label: 'raw screenshot',
      ok: item.evidenceStatus?.rawScreenshot ?? Boolean(item.rawScreenshotRef || item.screenshotRef || item.screenshot?.rawScreenshotRef || item.screenshot?.rawDataUrl || item.screenshot?.dataUrl),
    },
    {
      label: 'annotated screenshot',
      ok: item.evidenceStatus?.annotatedScreenshot ?? Boolean(item.annotatedScreenshotRef || item.screenshot?.annotatedScreenshotRef || item.screenshot?.annotatedDataUrl || item.evidenceAssets?.some((asset) => asset.kind === 'scrubbed-annotated-screenshot')),
    },
    {
      label: 'target snapshot',
      ok: item.evidenceStatus?.targetSnapshot ?? Boolean(item.target.selector && item.target.path),
    },
    {
      label: 'runtime snapshot',
      ok: item.evidenceStatus?.runtimeSnapshot ?? Boolean(item.runtime.page && item.runtime.scenarioId),
    },
    {
      label: 'scrubbed',
      ok: item.evidenceStatus?.scrubbed ?? Boolean(item.evidenceAssets?.some((asset) => asset.kind === 'scrubbed-annotated-screenshot')),
    },
  ];
  const ready = checks.filter((check) => check.ok).length;
  const computedStatus = ready === checks.length ? 'complete' : ready > 0 ? 'partial' : 'missing';
  return {
    status: item.evidenceStatus?.status ?? computedStatus,
    ready,
    total: checks.length,
    checks,
    diagnostics: item.evidenceStatus?.diagnostics ?? [],
  };
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

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
