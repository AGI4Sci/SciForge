import { RefreshCcw } from 'lucide-react';
import { DelayedHelpButton } from '../DelayedHelpButton';
import { Badge, cx } from '../uiPrimitives';
import type { RepairReadinessRow, RepairReadinessState } from './feedbackRepairReadiness';

export type FeedbackPageStateNoticeState = RepairReadinessState;

export interface FeedbackPageStateNotice {
  id: string;
  label: string;
  value: string;
  detail: string;
  state: FeedbackPageStateNoticeState;
}

interface FeedbackRepairReadinessViewModel {
  status: RepairReadinessState;
  summary: string;
  rows: RepairReadinessRow[];
  nextAction?: string;
  needsPeerSettings: boolean;
  providerReady: boolean;
}

interface FeedbackInboxDiagnosticsProps {
  pageStateNotices: FeedbackPageStateNotice[];
  repairReadiness: FeedbackRepairReadinessViewModel;
  writerReadinessRows: RepairReadinessRow[];
  onOpenGithubSettings: () => void;
  onRefreshPageDiagnostics: () => void;
}

export function FeedbackInboxDiagnostics({
  pageStateNotices,
  repairReadiness,
  writerReadinessRows,
  onOpenGithubSettings,
  onRefreshPageDiagnostics,
}: FeedbackInboxDiagnosticsProps) {
  const pageAttentionCount = pageStateNotices.filter((notice) => notice.state !== 'ready').length;
  const hasBlockedPageNotice = pageStateNotices.some((notice) => notice.state === 'blocked');
  return (
    <>
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
            {!repairReadiness.providerReady ? (
              <DelayedHelpButton onClick={onOpenGithubSettings} help="打开设置中的 Model Provider / API Key；provider 状态只提示，不改变 repair 目标路由。">
                Provider 设置
              </DelayedHelpButton>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="feedback-page-state" aria-label="页面状态诊断">
        <div className="feedback-page-state-head">
          <div>
            <strong>页面状态诊断</strong>
            <span>把用户下一步会撞到的本地状态、凭据、证据、确认门槛和 repair 环境提前摊开。</span>
          </div>
          <div className="feedback-page-state-actions">
            <button type="button" className="feedback-page-state-refresh" onClick={onRefreshPageDiagnostics} aria-label="重新检查页面状态诊断">
              <RefreshCcw size={14} aria-hidden />
              重新检查
            </button>
            <Badge variant={hasBlockedPageNotice ? 'warning' : 'success'}>
              {pageAttentionCount} needs attention
            </Badge>
          </div>
        </div>
        <div className="feedback-page-state-grid">
          {pageStateNotices.map((notice) => (
            <div className={cx('feedback-page-state-row', notice.state)} key={notice.id}>
              <span>{notice.label}</span>
              <strong>{notice.value}</strong>
              <code>{notice.detail}</code>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
