import { ArchiveRestore, CheckCheck, GitBranch, Loader2, TerminalSquare, Trash2 } from 'lucide-react';
import type { FeedbackCommentStatus } from '../../domain';
import { DelayedHelpButton } from '../DelayedHelpButton';

export type FeedbackStatusFilter = FeedbackCommentStatus | 'all';
export type FeedbackGitOperationMode = 'manual' | 'auto';
export type FeedbackToolbarGithubActionKind = 'submit-issue' | 'sync-open-issues';

export const FEEDBACK_STATUS_FILTERS: Array<{ value: FeedbackStatusFilter; label: string }> = [
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

interface FeedbackInboxToolbarProps {
  activeCommentsLength: number;
  allVisibleSelected: boolean;
  bulkStatus: FeedbackCommentStatus;
  effectiveGithubRepo: string;
  feedbackGithubToken?: string;
  gitOperationMode: FeedbackGitOperationMode;
  githubActionHint: string;
  githubDryRun: boolean;
  githubSubmitBusy: boolean;
  githubSyncBusy: boolean;
  issueScopeCommentsLength: number;
  queueActionHint: string;
  searchQuery: string;
  selectedDeletedCount: number;
  selectedRepairBusy: boolean;
  selectedRepairCandidateId?: string;
  selectedVisibleActiveCount: number;
  selectionSummary: string;
  statusCounts: Partial<Record<FeedbackCommentStatus, number>>;
  statusFilter: FeedbackStatusFilter;
  visibleIdsLength: number;
  onBulkStatusChange: (status: FeedbackCommentStatus) => void;
  onCreateRequest: () => void;
  onExportBundle: () => void;
  onGitOperationModeChange: (mode: FeedbackGitOperationMode) => void;
  onMarkSelected: () => void;
  onRepairSelected: () => void;
  onRequestGithubAction: (kind: FeedbackToolbarGithubActionKind) => void;
  onRestoreSelected: () => void;
  onSearchQueryChange: (value: string) => void;
  onSelectCurrentList: () => void;
  onSoftDeleteSelected: () => void;
  onStatusFilterChange: (filter: FeedbackStatusFilter) => void;
}

export function FeedbackInboxToolbar({
  activeCommentsLength,
  allVisibleSelected,
  bulkStatus,
  effectiveGithubRepo,
  feedbackGithubToken,
  gitOperationMode,
  githubActionHint,
  githubDryRun,
  githubSubmitBusy,
  githubSyncBusy,
  issueScopeCommentsLength,
  queueActionHint,
  searchQuery,
  selectedDeletedCount,
  selectedRepairBusy,
  selectedRepairCandidateId,
  selectedVisibleActiveCount,
  selectionSummary,
  statusCounts,
  statusFilter,
  visibleIdsLength,
  onBulkStatusChange,
  onCreateRequest,
  onExportBundle,
  onGitOperationModeChange,
  onMarkSelected,
  onRepairSelected,
  onRequestGithubAction,
  onRestoreSelected,
  onSearchQueryChange,
  onSelectCurrentList,
  onSoftDeleteSelected,
  onStatusFilterChange,
}: FeedbackInboxToolbarProps) {
  return (
    <section className="feedback-toolbar">
      <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as FeedbackStatusFilter)} aria-label="按反馈状态筛选">
        {FEEDBACK_STATUS_FILTERS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.value === 'all' ? activeCommentsLength : statusCounts[option.value] ?? 0})
          </option>
        ))}
      </select>
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="搜索反馈、Issue、ref..."
        aria-label="搜索反馈、GitHub Issue 或证据 ref"
      />
      <span className="feedback-selection-count">{selectionSummary}</span>
      <label className="feedback-selection-count" aria-label="git operation mode">
        Git:
        <select value={gitOperationMode} onChange={(event) => onGitOperationModeChange(event.target.value === 'auto' ? 'auto' : 'manual')}>
          <option value="manual">手动操作</option>
          <option value="auto">自动操作</option>
        </select>
      </label>
      <DelayedHelpButton
        onClick={onSelectCurrentList}
        disabled={!visibleIdsLength || allVisibleSelected}
        help="选择当前筛选和搜索结果中的所有反馈；隐藏选择不会参与当前操作。"
      >
        选择当前列表
      </DelayedHelpButton>
      <select value={bulkStatus} onChange={(event) => onBulkStatusChange(event.target.value as FeedbackCommentStatus)} aria-label="批量标记状态">
        {BULK_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <DelayedHelpButton
        onClick={onMarkSelected}
        disabled={!selectedVisibleActiveCount}
        help="只把当前可见且已选的未删除反馈标记为下拉框中的共享状态；隐藏选择不会被修改。"
      >
        <CheckCheck size={14} aria-hidden />
        批量标记
      </DelayedHelpButton>
      <DelayedHelpButton
        onClick={onRestoreSelected}
        disabled={!selectedDeletedCount}
        help="把当前可见且已选的软删除反馈恢复到删除前状态；不会改动 GitHub Issue、repair audit、patch 或截图证据。"
      >
        <ArchiveRestore size={14} aria-hidden />
        恢复选中
      </DelayedHelpButton>
      <DelayedHelpButton
        className="danger"
        onClick={onSoftDeleteSelected}
        disabled={!selectedVisibleActiveCount}
        help="软删除当前可见且已选的本地反馈；不会删除 GitHub Issue、repair audit、workspace patch 或截图原始证据。"
      >
        <Trash2 size={14} aria-hidden />
        软删除
      </DelayedHelpButton>
      <DelayedHelpButton
        onClick={onCreateRequest}
        disabled={!selectedVisibleActiveCount}
        help="把当前可见且已选的反馈合并成一个本地 Request，便于后续按任务追踪。"
      >
        <GitBranch size={14} aria-hidden />
        生成 Request
      </DelayedHelpButton>
      <DelayedHelpButton
        onClick={onRepairSelected}
        disabled={!selectedRepairCandidateId || selectedRepairBusy}
        help={selectedVisibleActiveCount > 1
          ? '一次只启动一条 repair 线程；先只选择一条反馈，避免批量误触发。'
          : selectedRepairCandidateId
            ? '对已选反馈启动 Runtime Codex repair；同一反馈下会新增一条可追踪修复线程。'
            : '先选择一条未删除反馈。'}
      >
        {selectedRepairCandidateId && selectedRepairBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : <TerminalSquare size={14} aria-hidden />}
        修复选中
      </DelayedHelpButton>
      <DelayedHelpButton
        onClick={onExportBundle}
        help="导出当前可见已选反馈；如果当前列表没有可见选择，则导出当前筛选和搜索结果。"
      >
        导出 Bundle
      </DelayedHelpButton>
      <DelayedHelpButton
        className="feedback-github-primary"
        onClick={() => onRequestGithubAction('submit-issue')}
        disabled={!issueScopeCommentsLength || githubSubmitBusy}
        help={githubDryRun
          ? `Dry-run：生成 ${effectiveGithubRepo || '配置仓库'} Issue payload，不调用 GitHub API，也不改本地 GitHub-open 状态。`
          : `向 ${effectiveGithubRepo || '配置仓库'} 创建 GitHub Issue；需要在设置中填写具备 Issues 读写权限的 PAT。`}
      >
        {githubSubmitBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
        {githubDryRun ? 'Dry-run GitHub' : '提交到 GitHub'}
      </DelayedHelpButton>
      <DelayedHelpButton
        onClick={() => onRequestGithubAction('sync-open-issues')}
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
      {queueActionHint ? <span className="feedback-queue-hint" role="status">{queueActionHint}</span> : null}
      {githubActionHint ? <span className="feedback-github-hint" role="status">{githubActionHint}</span> : null}
    </section>
  );
}
