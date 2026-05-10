import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { defaultSciForgeConfig } from '../../config';
import { loadFeedbackIssueHandoffBundle, loadSciForgeInstanceManifest } from '../../api/workspaceClient';
import { buildFeedbackBundle, buildFeedbackGithubIssueBody, buildFeedbackGithubIssueTitle, submitFeedbackGithubIssue, syncFeedbackGithubIssues } from '../../feedback/githubFeedback';
import { feedbackRepairAuditForIssue } from '../../feedback/feedbackWorkspace';
import { FeedbackRepairAuditPanel } from '../../feedback/FeedbackRepairAuditPanel';
import { FeedbackScreenshotPreview } from '../../feedback/FeedbackScreenshotPreview';
import { makeId, nowIso, type FeedbackCommentRecord, type FeedbackCommentStatus, type FeedbackRepairResultRecord, type FeedbackRepairRunRecord, type GithubSyncedOpenIssueRecord, type SciForgeConfig, type SciForgeWorkspaceState } from '../../domain';
import { DelayedHelpButton } from '../DelayedHelpButton';
import { exportJsonFile } from '../exportUtils';
import { APP_BUILD_ID, feedbackStatusVariant, formatSessionTime, requestTitleFromFeedback } from '../appShell/appHelpers';
import { Badge, cx } from '../uiPrimitives';

export function FeedbackInboxPage({
  config,
  comments,
  requests,
  repairRuns,
  repairResults,
  onStatusChange,
  onDelete,
  onCreateRequest,
  onRepairRunWritten,
  feedbackGithubRepo,
  feedbackGithubToken,
  githubSyncedOpenIssues,
  onReplaceGithubSyncedOpenIssues,
  onImportGithubOpenIssues,
  onGithubIssueCreated,
  onOpenGithubSettings,
}: {
  config: SciForgeConfig;
  comments: FeedbackCommentRecord[];
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>;
  repairRuns: FeedbackRepairRunRecord[];
  repairResults: FeedbackRepairResultRecord[];
  onStatusChange: (ids: string[], status: FeedbackCommentStatus) => void;
  onDelete: (ids: string[]) => void;
  onCreateRequest: (ids: string[], title: string) => void;
  onRepairRunWritten: (run: FeedbackRepairRunRecord) => void;
  feedbackGithubRepo?: string;
  feedbackGithubToken?: string;
  githubSyncedOpenIssues: GithubSyncedOpenIssueRecord[];
  onReplaceGithubSyncedOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => void;
  onImportGithubOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => number;
  onGithubIssueCreated: (commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) => void;
  onOpenGithubSettings: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FeedbackCommentStatus | 'all'>('all');
  const [githubActionHint, setGithubActionHint] = useState('');
  const [githubSubmitBusy, setGithubSubmitBusy] = useState(false);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [handoffBusyById, setHandoffBusyById] = useState<Record<string, boolean>>({});
  const [handoffTargetById, setHandoffTargetById] = useState<Record<string, string>>({});
  const [handoffHintById, setHandoffHintById] = useState<Record<string, string>>({});
  const effectiveGithubRepo = useMemo(
    () => (feedbackGithubRepo?.trim() || defaultSciForgeConfig.feedbackGithubRepo || '').trim(),
    [feedbackGithubRepo],
  );
  const repairTargets = useMemo(
    () => (config.peerInstances ?? []).filter((peer) => peer.enabled && peer.trustLevel === 'repair'),
    [config.peerInstances],
  );
  const visibleComments = comments
    .filter((comment) => statusFilter === 'all' || comment.status === statusFilter)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const selectedComments = comments.filter((comment) => selectedIds.includes(comment.id));
  const bundle = buildFeedbackBundle(selectedComments.length ? selectedComments : visibleComments, requests, APP_BUILD_ID);
  const issueScopeComments = selectedComments.length ? selectedComments : visibleComments;
  const issueTitle = buildFeedbackGithubIssueTitle(issueScopeComments);
  const issueBody = buildFeedbackGithubIssueBody(issueScopeComments, requests, APP_BUILD_ID);
  const visibleIds = visibleComments.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;

  function ensureGithubTokenOrOpenSettings(): boolean {
    const token = feedbackGithubToken?.trim();
    if (token) return true;
    setGithubActionHint(`需要 GitHub Personal Access Token：已打开「设置」，请在「反馈 GitHub Token」填写（需 Issues 读写）。当前仓库 ${effectiveGithubRepo || '（未解析）'}。`);
    onOpenGithubSettings();
    return false;
  }

  async function submitGithubIssueApi() {
    if (!issueScopeComments.length) return;
    if (!ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken!.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSubmitBusy(true);
    try {
      const created = await submitFeedbackGithubIssue({ repo, token, title: issueTitle, body: issueBody });
      onGithubIssueCreated(issueScopeComments.map((comment) => comment.id), {
        number: created.number,
        htmlUrl: created.htmlUrl,
        title: issueTitle,
      });
      setGithubActionHint(`已创建 Issue #${created.number}，正在打开页面…`);
      window.open(created.htmlUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
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

  function deleteSelected(ids: string[]) {
    if (!ids.length) return;
    const confirmed = window.confirm(`确认删除 ${ids.length} 条反馈？问题解决后删除不会影响已导出的 Bundle。`);
    if (!confirmed) return;
    onDelete(ids);
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
    if (!target) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '没有可用的 repair 目标实例。请先配置 enabled + repair trust 的 peer instance。' }));
      return;
    }
    const targetConfig = {
      ...config,
      workspaceWriterBaseUrl: target.workspaceWriterUrl,
      workspacePath: target.workspacePath,
    };
    setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
    setHandoffHintById((current) => ({ ...current, [item.id]: `正在准备交给 ${target.name}...` }));
    try {
      const bundlePromise = loadFeedbackIssueHandoffBundle(config, item.id);
      const manifestPromise = loadSciForgeInstanceManifest(targetConfig, target.workspacePath);
      const [bundleResult, manifestResult] = await Promise.allSettled([bundlePromise, manifestPromise]);
      const bundle = bundleResult.status === 'fulfilled' ? bundleResult.value : undefined;
      const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : undefined;
      const executorName = manifest?.instance.name || target.name;
      const executorId = manifest?.instance.id || target.name;
      const run: FeedbackRepairRunRecord = {
        schemaVersion: 1,
        id: makeId('feedback-repair-run'),
        issueId: item.id,
        status: 'assigned',
        externalInstanceId: executorId,
        externalInstanceName: executorName,
        actor: 'feedback-inbox',
        startedAt: nowIso(),
        note: `已交给 ${executorName}。收件箱只记录 handoff 和审计，不运行修复 runner。`,
        metadata: {
          handoffKind: 'feedback-repair',
          sourceWorkspacePath: config.workspacePath || bundle?.workspacePath,
          targetWorkspacePath: target.workspacePath,
          targetAppUrl: target.appUrl,
          targetWorkspaceWriterUrl: target.workspaceWriterUrl,
          handoffBundle: bundle,
          targetManifest: manifest,
          targetManifestUnavailable: manifestResult.status === 'rejected' ? String(manifestResult.reason) : undefined,
        },
      };
      onRepairRunWritten(run);
      setHandoffHintById((current) => ({ ...current, [item.id]: `已交给 ${executorName}；等待外部实例写回 repair result。` }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Handoff 记录失败：${message}` }));
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
          <p>汇总多用户页面评论、元素定位和运行时上下文，供 Codex 批量修改代码并回写发布状态。</p>
        </div>
        <div className="feedback-stats">
          <span><strong>{comments.length}</strong> comments</span>
          <span><strong>{requests.length}</strong> requests</span>
          <span><strong>{comments.filter((item) => item.status === 'open').length}</strong> open</span>
          <span><strong>{githubSyncedOpenIssues.length}</strong> GitHub open</span>
        </div>
      </section>
      <section className="feedback-toolbar">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FeedbackCommentStatus | 'all')}>
          <option value="all">全部状态</option>
          <option value="open">open</option>
          <option value="triaged">triaged</option>
          <option value="planned">planned</option>
          <option value="fixed">fixed</option>
          <option value="needs-discussion">needs-discussion</option>
          <option value="wont-fix">wont-fix</option>
        </select>
        <span className="feedback-selection-count">{selectedIds.length ? `已选择 ${selectedIds.length} 条` : `当前列表 ${visibleComments.length} 条`}</span>
        <DelayedHelpButton
          onClick={() => setSelectedIds(visibleIds)}
          disabled={!visibleIds.length || visibleSelectedCount === visibleIds.length}
          help="选择当前筛选结果中的所有反馈，适合批量标记、生成 Request 或提交到 GitHub。"
        >
          选择当前列表
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onStatusChange(selectedIds, 'triaged')}
          disabled={!selectedIds.length}
          help="把已选反馈标为 triaged，表示已经确认并进入处理队列。"
        >
          标记 triaged
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onStatusChange(selectedIds, 'fixed')}
          disabled={!selectedIds.length}
          help="把已选反馈标为 fixed，适合修复完成后回写状态。"
        >
          标记 fixed
        </DelayedHelpButton>
        <DelayedHelpButton
          className="danger"
          onClick={() => deleteSelected(selectedIds)}
          disabled={!selectedIds.length}
          help="删除已选本地反馈；不会删除已经导出的 Bundle 或 GitHub Issue。"
        >
          删除选中
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onCreateRequest(selectedIds, requestTitleFromFeedback(selectedComments))}
          disabled={!selectedIds.length}
          help="把已选反馈合并成一个本地 Request，便于后续按任务追踪。"
        >
          生成 Request
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => exportJsonFile(`sciforge-feedback-${nowIso().slice(0, 10)}.json`, bundle)}
          help="导出当前选择或当前列表的反馈 Bundle，供离线归档或交给 Codex 批量处理。"
        >
          导出 Bundle
        </DelayedHelpButton>
        <DelayedHelpButton
          className="feedback-github-primary"
          onClick={() => void submitGithubIssueApi()}
          disabled={!issueScopeComments.length || githubSubmitBusy}
          help={`向 ${effectiveGithubRepo || '配置仓库'} 创建 GitHub Issue；需要在设置中填写具备 Issues 读写权限的 PAT。`}
        >
          {githubSubmitBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
          提交到 GitHub
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
            <article className={cx('feedback-card', selectedIds.includes(item.id) && 'selected')} key={item.id}>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`选择反馈 ${item.id}`} />
              <div className="feedback-card-main">
                {(() => {
                  const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults);
                  const targetValue = handoffTargetById[item.id] || repairTargets[0]?.name || '';
                  return (
                    <>
                <div className="feedback-card-head">
                  <strong>{item.comment}</strong>
                  <div className="feedback-card-head-actions">
                    <Badge variant={feedbackStatusVariant(item.status)}>{item.status}</Badge>
                    <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'warning' : 'muted'}>{item.priority}</Badge>
                    <Badge variant={audit.badge}>{audit.label}</Badge>
                  </div>
                </div>
                <p>{item.authorName} · {formatSessionTime(item.createdAt)} · {item.runtime.page} · {item.runtime.scenarioId}</p>
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
                <div className="feedback-target-summary compact">
                  <span>target</span>
                  <code>{item.target.selector}</code>
                  <span>runtime</span>
                  <code>{item.runtime.sessionId ?? 'no-session'} / {item.runtime.activeRunId ?? 'no-run'}</code>
                </div>
                <FeedbackRepairAuditPanel
                  audit={audit}
                  repairTargets={repairTargets}
                  targetValue={targetValue}
                  busy={handoffBusyById[item.id]}
                  hint={handoffHintById[item.id]}
                  onTargetChange={(targetName) => setHandoffTargetById((current) => ({ ...current, [item.id]: targetName }))}
                  onHandoff={() => void handoffFeedbackIssue(item)}
                />
                <FeedbackScreenshotPreview item={item} />
                {item.tags.length ? <div className="feedback-tags">{item.tags.map((tag) => <code key={tag}>{tag}</code>)}</div> : null}
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
