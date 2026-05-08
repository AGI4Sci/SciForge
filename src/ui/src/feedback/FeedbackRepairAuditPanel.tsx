import { ArrowRight, Loader2 } from 'lucide-react';
import type { PeerInstance } from '../domain';
import type { FeedbackRepairAuditViewModel } from './feedbackWorkspace';
import { Badge, cx } from '../app/uiPrimitives';
import { DelayedHelpButton } from '../app/DelayedHelpButton';

export interface FeedbackRepairAuditPanelProps {
  audit: FeedbackRepairAuditViewModel;
  repairTargets: PeerInstance[];
  targetValue: string;
  busy?: boolean;
  hint?: string;
  onTargetChange: (targetName: string) => void;
  onHandoff: () => void;
}

export interface FeedbackRepairAuditRow {
  label: string;
  value: string;
  href?: string;
}

export function FeedbackRepairAuditPanel({
  audit,
  repairTargets,
  targetValue,
  busy = false,
  hint,
  onTargetChange,
  onHandoff,
}: FeedbackRepairAuditPanelProps) {
  return (
    <div className="feedback-repair-audit" aria-label="repair audit panel">
      <div className="feedback-repair-audit-head">
        <div className="feedback-repair-audit-title">
          <strong>{audit.headline}</strong>
          <Badge variant={audit.badge}>{audit.label}</Badge>
        </div>
        <span>{audit.detail}</span>
      </div>
      <div className="feedback-repair-handoff">
        <select
          value={targetValue}
          onChange={(event) => onTargetChange(event.target.value)}
          disabled={!repairTargets.length || busy}
          aria-label="选择 repair 目标实例"
        >
          {repairTargets.length ? repairTargets.map((peer) => (
            <option key={peer.name} value={peer.name}>{peer.name}</option>
          )) : <option value="">无 repair 实例</option>}
        </select>
        <DelayedHelpButton
          onClick={onHandoff}
          disabled={!repairTargets.length || busy}
          help="记录 repair handoff 并把目标实例写入审计；收件箱只负责交接和展示写回结果。"
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <ArrowRight size={14} aria-hidden />}
          交给实例...
        </DelayedHelpButton>
      </div>
      <div className="feedback-repair-evidence-grid">
        {repairAuditRows(audit).map((row) => (
          <AuditRow key={row.label} label={row.label} value={row.value} href={row.href} />
        ))}
      </div>
      {repairAuditStateMessages(audit).map((message) => (
        <p className="feedback-repair-summary" key={message}>{message}</p>
      ))}
      {audit.summary ? <p className="feedback-repair-summary">{audit.summary}</p> : null}
      {audit.testsPassed ? <p className="feedback-repair-summary">测试通过。</p> : null}
      {audit.missingTestEvidence ? <p className="feedback-repair-warning">缺测试证据，不能认定已修复。</p> : null}
      {audit.needsHumanVerification ? <p className="feedback-repair-warning">需要人工核验。</p> : null}
      {audit.githubSynced ? <p className="feedback-repair-summary">已同步 GitHub。</p> : null}
      {hint ? <p className={cx('feedback-repair-hint', hint.includes('失败') && 'danger')}>{hint}</p> : null}
    </div>
  );
}

export function repairAuditRows(audit: FeedbackRepairAuditViewModel): FeedbackRepairAuditRow[] {
  const refs = audit.refs ?? {};
  return [
    { label: 'latestRunStatus', value: audit.latestRunStatus },
    { label: 'latestResultVerdict', value: audit.latestResultVerdict ?? 'none' },
    { label: 'executorInstance', value: audit.executorInstance ?? 'pending' },
    { label: 'summary', value: audit.summary ?? 'none' },
    { label: 'changedFiles', value: audit.changedFiles.length ? audit.changedFiles.join(', ') : 'none' },
    { label: 'testResults', value: audit.tests.length ? audit.tests.map((test) => `${test.status}: ${test.command}${test.summary ? ` (${test.summary})` : ''}`).join(' | ') : 'missing' },
    { label: 'humanVerification', value: audit.humanVerification ?? (audit.needsHumanVerification ? 'required' : 'not-required') },
    { label: 'commit', value: audit.commit ?? refs.commitSha ?? 'none', href: refs.commitUrl },
    { label: 'prUrl', value: refs.prUrl ?? 'none', href: refs.prUrl },
    { label: 'patchRef', value: refs.patchRef ?? audit.diffRef ?? 'none' },
    { label: 'githubSyncStatus', value: audit.githubSyncStatus ?? 'none' },
    { label: 'githubCommentUrl', value: audit.githubCommentUrl ?? 'not-synced', href: audit.githubCommentUrl },
  ];
}

export function repairAuditStateMessages(audit: FeedbackRepairAuditViewModel) {
  const executor = audit.executorInstance;
  const messages: string[] = [];
  if (executor && audit.status === 'assigned') messages.push(`已交给 ${executor}。`);
  if (executor && ['analyzing', 'patching', 'testing'].includes(audit.status)) messages.push(`${executor} 正在处理。`);
  return messages;
}

function AuditRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <>
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">{value}</a>
      ) : (
        <code>{value}</code>
      )}
    </>
  );
}
