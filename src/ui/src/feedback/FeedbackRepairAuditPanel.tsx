import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Clipboard, Download, Eye, GitCommit, GitPullRequest, Loader2, Send, ShieldAlert, Square, TerminalSquare } from 'lucide-react';
import type { FeedbackRepairActionRecord, FeedbackRepairGuidanceRecord, FeedbackRepairResultRecord, FeedbackRepairRunRecord, PeerInstance } from '../domain';
import type { FeedbackRepairAuditViewModel } from './feedbackWorkspace';
import { Badge, cx } from '../app/uiPrimitives';
import { DelayedHelpButton } from '../app/DelayedHelpButton';
import { exportJsonFile } from '../app/exportUtils';

export interface FeedbackRepairAuditPanelProps {
  audit: FeedbackRepairAuditViewModel;
  repairTargets: PeerInstance[];
  targetValue: string;
  busy?: boolean;
  hint?: string;
  onTargetChange: (targetName: string) => void;
  onHandoff: () => void;
  onConfirmAction?: (action: FeedbackRepairActionRecord['action']) => void;
  onLoadTerminalMirror?: (input: { terminalMirrorRef: string; cursor: number }) => Promise<{ entries: TerminalMirrorEntry[]; nextCursor: number; totalEntries: number }>;
  onStopRepair?: (input: { repairRunId: string; terminalMirrorRef?: string }) => Promise<{ stopped: boolean; status: string; message: string }>;
  onSendGuidance?: (input: { repairRunId: string; repairResultId?: string; terminalMirrorRef?: string; message: string }) => Promise<{ guidance: FeedbackRepairGuidanceRecord }>;
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
  onConfirmAction,
  onLoadTerminalMirror,
  onStopRepair,
  onSendGuidance,
}: FeedbackRepairAuditPanelProps) {
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [copyHint, setCopyHint] = useState('');
  const [stopHint, setStopHint] = useState('');
  const [stopBusy, setStopBusy] = useState(false);
  const [guidanceText, setGuidanceText] = useState('');
  const [guidanceHint, setGuidanceHint] = useState('');
  const [guidanceBusy, setGuidanceBusy] = useState(false);
  const [liveTerminalEntries, setLiveTerminalEntries] = useState<TerminalMirrorEntry[]>([]);
  const terminal = repairTerminalMirror(audit, liveTerminalEntries);
  const evidence = repairEvidenceCompleteness(audit, terminal);
  const confirmationBoundaries = repairConfirmationBoundaries(audit);
  const safeMode = repairSafeMode(audit);
  const visibleTerminalEntries = terminalCollapsed ? terminal.entries.slice(-6) : terminal.entries;
  const stopControl = repairStopControl(audit);
  const canStop = Boolean(onStopRepair && stopControl.available);
  const canSendGuidance = Boolean(onSendGuidance && audit.latestRun?.id && guidanceText.trim() && !guidanceBusy);

  useEffect(() => {
    setLiveTerminalEntries([]);
    setStopHint('');
    setGuidanceHint('');
  }, [terminal.ref]);

  useEffect(() => {
    if (!terminal.ref || !onLoadTerminalMirror) return undefined;
    let cancelled = false;
    let cursor = 0;
    let timer: number | undefined;
    const load = async () => {
      try {
        const tail = await onLoadTerminalMirror({ terminalMirrorRef: terminal.ref!, cursor });
        if (cancelled) return;
        cursor = tail.nextCursor;
        setLiveTerminalEntries((current) => normalizeTerminalEntries([current, tail.entries]));
      } catch {
        if (!cancelled) setLiveTerminalEntries((current) => current);
      }
    };
    void load();
    if (stopControl.available) {
      timer = window.setInterval(() => void load(), 1500);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [onLoadTerminalMirror, stopControl.available, terminal.ref]);

  async function stopRepair() {
    if (!canStop || !audit.latestRun?.id || !onStopRepair) return;
    setStopBusy(true);
    setStopHint('正在请求停止当前 Runtime Codex repair turn...');
    try {
      const stop = await onStopRepair({ repairRunId: audit.latestRun.id, terminalMirrorRef: terminal.ref });
      setStopHint(stop.message || (stop.stopped ? 'Stop requested.' : `Stop failed closed: ${stop.status}`));
    } catch (error) {
      setStopHint(`Stop failed closed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStopBusy(false);
    }
  }

  async function sendGuidance() {
    if (!canSendGuidance || !audit.latestRun?.id || !onSendGuidance) return;
    const message = guidanceText.trim();
    setGuidanceBusy(true);
    setGuidanceHint('正在写入 guidance audit...');
    try {
      const response = await onSendGuidance({
        repairRunId: audit.latestRun.id,
        repairResultId: audit.latestResult?.id,
        terminalMirrorRef: terminal.ref,
        message,
      });
      setGuidanceText('');
      setGuidanceHint(response.guidance.responseSummary || `Guidance ${response.guidance.status}.`);
    } catch (error) {
      setGuidanceHint(`Guidance failed closed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGuidanceBusy(false);
    }
  }
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
          disabled={busy}
          help={repairTargets.length
            ? '记录 repair handoff 并把目标实例写入审计；收件箱只负责交接和展示写回结果。'
            : '没有 repair 实例时也会写入 blocked audit，保留可追踪的 readiness 诊断。'}
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <ArrowRight size={14} aria-hidden />}
          {repairTargets.length ? '交给实例...' : '记录阻断'}
        </DelayedHelpButton>
      </div>
      <div className="feedback-repair-evidence-grid">
        {repairAuditRows(audit).map((row) => (
          <AuditRow key={row.label} label={row.label} value={row.value} href={row.href} />
        ))}
      </div>
      <div className={cx('feedback-repair-evidence-completeness', evidence.status)}>
        <div className="feedback-repair-subhead">
          <strong>Evidence completeness</strong>
          <Badge variant={evidence.status === 'complete' ? 'success' : evidence.status === 'partial' ? 'warning' : 'danger'}>
            {evidence.ready}/{evidence.total}
          </Badge>
        </div>
        <div className="feedback-repair-evidence-pills">
          {evidence.items.map((item) => (
            <span className={cx(item.state)} key={item.label} title={item.detail}>
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="feedback-repair-terminal" aria-label="repair terminal mirror">
        <div className="feedback-repair-terminal-head">
          <div>
            <TerminalSquare size={14} aria-hidden />
            <strong>Terminal mirror</strong>
            <span>{terminal.ref ? terminal.ref : 'waiting for repair run metadata'}</span>
          </div>
          <div className="feedback-repair-terminal-actions">
            <DelayedHelpButton
              onClick={() => setTerminalCollapsed((current) => !current)}
              disabled={!terminal.entries.length}
              help="折叠或展开按时间顺序透传的 Codex CLI terminal mirror；GUI 不从这里推断完成结论。"
            >
              {terminalCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              {terminalCollapsed ? '展开' : '折叠'}
            </DelayedHelpButton>
            <DelayedHelpButton
              onClick={() => void copyTerminalMirror(terminal.copyText, setCopyHint)}
              disabled={!terminal.copyText}
              help="复制当前 terminal mirror 文本；写入 GitHub 或 audit summary 前仍需 bounded scrub。"
            >
              <Clipboard size={14} aria-hidden />
              复制
            </DelayedHelpButton>
            <DelayedHelpButton
              onClick={() => exportJsonFile(`sciforge-repair-bundle-${safeFilenamePart(audit.issueId)}-${new Date().toISOString().slice(0, 10)}.json`, terminal.exportPayload)}
              disabled={!terminal.copyText && !terminal.ref}
              help="导出 repair run/result metadata、patch/diff/tests/audit refs 和 terminal mirror，供离线审计。"
            >
              <Download size={14} aria-hidden />
              导出 Bundle
            </DelayedHelpButton>
            <DelayedHelpButton
              onClick={() => void stopRepair()}
              disabled={!canStop || stopBusy}
              help={canStop
                ? '请求 backend 安全取消当前 Runtime Codex repair turn；不能确认可停时 backend 会 fail closed 并写入 terminal mirror。'
                : '当前没有可安全停止的运行中 Runtime Codex repair turn；terminal mirror 保持只读。'}
            >
              {stopBusy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Square size={14} aria-hidden />}
              停止
            </DelayedHelpButton>
          </div>
        </div>
        {terminal.entries.length ? (
          <pre className={cx('feedback-repair-terminal-body', terminalCollapsed && 'collapsed')}>
            {visibleTerminalEntries.map((entry, index) => (
              <span className={cx('feedback-repair-terminal-line', entry.stream)} key={`${entry.timestamp}-${entry.stream}-${index}`}>
                <span className="feedback-repair-terminal-prefix">[{entry.timestamp}] {entry.stream}</span>
                {entry.text}
              </span>
            ))}
          </pre>
        ) : (
          <p className="feedback-repair-terminal-empty">尚无 inline terminal lines；等待 repair run 写入 mirror 或 terminalMirrorRef。</p>
        )}
        {copyHint ? <p className="feedback-repair-hint">{copyHint}</p> : null}
        {stopHint ? <p className={cx('feedback-repair-hint', stopHint.includes('failed closed') && 'danger')}>{stopHint}</p> : null}
        {audit.latestRun?.id ? (
          <div className="feedback-repair-guidance" aria-label="repair guidance input">
            <textarea
              value={guidanceText}
              onChange={(event) => setGuidanceText(event.target.value)}
              placeholder="给 Runtime Codex repair 输入引导..."
              rows={3}
              aria-label="repair guidance"
            />
            <DelayedHelpButton
              onClick={() => void sendGuidance()}
              disabled={!canSendGuidance}
              help="把用户引导写入 audit 和 terminal mirror；若已有 Codex session id，backend 会用 Codex 原生 resume 继续。"
            >
              {guidanceBusy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Send size={14} aria-hidden />}
              发送引导
            </DelayedHelpButton>
          </div>
        ) : null}
        {guidanceHint ? <p className={cx('feedback-repair-hint', guidanceHint.includes('failed closed') && 'danger')}>{guidanceHint}</p> : null}
      </div>
      <div className="feedback-repair-confirmation" aria-label="repair confirmation boundaries">
        <div className="feedback-repair-subhead">
          <strong>Confirmation boundaries</strong>
          <Badge variant="warning">user gated</Badge>
        </div>
        <div className="feedback-repair-boundary-grid">
          {confirmationBoundaries.map((boundary) => (
            <div className={cx('feedback-repair-boundary', boundary.state)} key={boundary.label}>
              {boundary.icon === 'commit' ? <GitCommit size={14} aria-hidden /> : boundary.icon === 'pr' ? <GitPullRequest size={14} aria-hidden /> : <ShieldAlert size={14} aria-hidden />}
              <span>{boundary.label}</span>
              {boundary.href ? <a href={boundary.href} target="_blank" rel="noreferrer">{boundary.value}</a> : <code>{boundary.value}</code>}
            </div>
          ))}
        </div>
        <div className="feedback-repair-action-row">
          <DelayedHelpButton
            onClick={() => onConfirmAction?.('browser-recheck')}
            disabled={!onConfirmAction || !audit.latestResult}
            help="修复后从 Codex in-app browser 重新打开原问题路径，把可见复核结论和证据 refs 写入 repair audit。"
          >
            <Eye size={14} aria-hidden />
            记录 browser 复核
          </DelayedHelpButton>
          <DelayedHelpButton
            onClick={() => onConfirmAction?.('commit')}
            disabled={!onConfirmAction || !audit.latestResult || Boolean(audit.commit ?? audit.refs?.commitSha)}
            help="用户确认后，只在隔离 repair worktree 中创建本地 commit；不会 push、PR 或 merge。"
          >
            <GitCommit size={14} aria-hidden />
            确认本地 commit
          </DelayedHelpButton>
          <DelayedHelpButton
            onClick={() => onConfirmAction?.('push')}
            disabled={!onConfirmAction || !audit.latestResult}
            help="push 需要第二次单独确认；当前 writer 只记录 no-op 审计，不会真实 push。"
          >
            <ShieldAlert size={14} aria-hidden />
            push 二次确认
          </DelayedHelpButton>
          <DelayedHelpButton
            onClick={() => onConfirmAction?.('pr')}
            disabled={!onConfirmAction || !audit.latestResult}
            help="PR 需要第二次单独确认；当前 writer 只记录 no-op 审计，不会真实创建 PR。"
          >
            <GitPullRequest size={14} aria-hidden />
            PR 二次确认
          </DelayedHelpButton>
          <DelayedHelpButton
            onClick={() => onConfirmAction?.('merge')}
            disabled={!onConfirmAction || !audit.latestResult}
            help="merge 永远不能自动执行；点击也会被 backend fail closed。"
          >
            <ShieldAlert size={14} aria-hidden />
            merge 禁止
          </DelayedHelpButton>
        </div>
        {audit.actionHistory.length ? (
          <div className="feedback-repair-action-history" aria-label="repair action audit">
            <div className="feedback-repair-subhead">
              <strong>Action audit</strong>
              <Badge variant="muted">{audit.actionHistory.length}</Badge>
            </div>
            <div className="feedback-repair-action-history-list">
              {audit.actionHistory.slice(0, 5).map((action) => (
                <div className={cx('feedback-repair-action-history-item', action.status)} key={action.id}>
                  <div>
                    <strong>{action.action}</strong>
                    <Badge variant={action.status === 'completed' ? 'success' : action.status === 'blocked' ? 'danger' : 'warning'}>
                      {action.status}
                    </Badge>
                    <code>{action.sideEffect}</code>
                  </div>
                  <span>
                    {action.confirmedAt ?? action.requestedAt}
                    {action.safeModeConfirmed ? ' / safe-mode confirmed' : ''}
                  </span>
                  <p>{action.message}</p>
                  {action.browserVerification?.evidenceRefs?.length ? (
                    <p>browser evidence {action.browserVerification.evidenceRefs.join(', ')}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {audit.guidanceHistory.length ? (
          <div className="feedback-repair-action-history" aria-label="repair guidance audit">
            <div className="feedback-repair-subhead">
              <strong>Guidance audit</strong>
              <Badge variant="muted">{audit.guidanceHistory.length}</Badge>
            </div>
            <div className="feedback-repair-action-history-list">
              {audit.guidanceHistory.slice(0, 5).map((guidance) => (
                <div className={cx('feedback-repair-action-history-item', guidance.status === 'blocked' && 'blocked', guidance.status === 'resumed' && 'completed')} key={guidance.id}>
                  <div>
                    <strong>guidance</strong>
                    <Badge variant={guidance.status === 'resumed' ? 'success' : guidance.status === 'blocked' ? 'danger' : 'warning'}>
                      {guidance.status}
                    </Badge>
                    {guidance.codexSessionId ? <code>native resume</code> : <code>audit only</code>}
                  </div>
                  <span>{guidance.requestedAt} / {guidance.requestedBy}</span>
                  <p>{guidance.message}</p>
                  {guidance.responseSummary ? <p>{guidance.responseSummary}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className={cx('feedback-repair-safe-mode', safeMode.active && 'active')}>
          <ShieldAlert size={14} aria-hidden />
          <strong>{safeMode.active ? 'Safe mode active' : 'Safe mode standby'}</strong>
          <span>{safeMode.message}</span>
        </div>
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
    { label: 'browserRecheck', value: audit.latestBrowserVerificationLabel ?? 'not-recorded' },
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

export interface TerminalMirrorEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}

export function repairTerminalMirror(audit: FeedbackRepairAuditViewModel, liveEntries: TerminalMirrorEntry[] = []) {
  const run = audit.latestRun;
  const result = audit.latestResult;
  const runMetadata = recordValue(run?.metadata);
  const resultRecord = recordValue(result);
  const resultMetadata = recordValue(resultRecord?.metadata);
  const entries = normalizeTerminalEntries([
    run?.terminalMirror,
    runMetadata?.terminalMirror,
    resultRecord?.terminalMirror,
    resultMetadata?.terminalMirror,
    liveEntries,
  ]);
  const ref = firstString([
    run?.terminalMirrorRef,
    result?.terminalMirrorRef,
    metadataString(resultMetadata, 'terminalMirrorRef'),
    metadataString(runMetadata, 'terminalMirrorRef'),
    metadataString(recordValue(result?.refs), 'terminalMirrorRef'),
  ]);
  const planRef = firstString([
    run?.planRef,
    result?.planRef,
    metadataString(resultMetadata, 'planRef'),
    metadataString(runMetadata, 'planRef'),
  ]);
  const auditBundleRef = firstString([
    result?.auditBundleRef,
    metadataString(resultMetadata, 'auditBundleRef'),
    metadataString(recordValue(result?.refs), 'auditBundleRef'),
  ]);
  const guardDigests = recordValue(resultMetadata?.guardDigests) ?? recordValue(runMetadata?.guardDigests);
  const copyText = entries.map((entry) => `[${entry.timestamp}] ${entry.stream} ${entry.text}`).join('\n');
  const patchRef = result?.refs?.patchRef ?? result?.diffRef ?? metadataString(resultMetadata, 'patchRef');
  const diffRef = result?.diffRef ?? metadataString(resultMetadata, 'diffRef');
  const testOutputRefs = (result?.testResults ?? result?.tests ?? [])
    .map((test) => test.outputRef)
    .filter((value): value is string => Boolean(value));
  const evidenceRefs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
  const stopControl = repairStopControl(audit);
  return {
    ref,
    planRef,
    auditBundleRef,
    entries,
    copyText,
    exportPayload: {
      schemaVersion: 1,
      issueId: audit.issueId,
      terminalMirrorRef: ref,
      planRef,
      auditBundleRef,
      guardDigests,
      confirmationPolicy: run?.confirmationPolicy ?? recordValue(runMetadata?.confirmationPolicy) ?? recordValue(resultMetadata?.confirmationPolicy),
      entries,
      entryCount: entries.length,
      copyAvailable: Boolean(copyText),
      stopControl,
      repairBundle: {
        patchRef,
        diffRef,
        planRef,
        terminalMirrorRef: ref,
        auditBundleRef,
        testOutputRefs,
        evidenceRefs,
        changedFiles: audit.changedFiles,
        tests: audit.tests,
        refs: result?.refs,
        actionHistory: audit.actionHistory,
      },
      latestRun: run,
      latestResult: result,
    },
  };
}

function repairStopControl(audit: FeedbackRepairAuditViewModel) {
  const hasFinalOutcome = Boolean(audit.latestResult || audit.latestResultVerdict);
  const runIsRunning = audit.latestRun?.status === 'running' || audit.latestRunStatus === 'running';
  const available = Boolean(audit.latestRun?.id && runIsRunning && !hasFinalOutcome);
  return {
    available,
    reason: available
      ? 'safe stop endpoint may cancel only the active Runtime Codex turn'
      : hasFinalOutcome
        ? 'repair result is already available; no active repair turn is available to stop'
        : 'no running repair turn is available to stop',
  };
}

function normalizeTerminalEntries(sources: unknown[]): TerminalMirrorEntry[] {
  const entries: Array<TerminalMirrorEntry & { order: number }> = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isTerminalMirrorEntry(entry)) continue;
      entries.push({ ...entry, order: entries.length });
    }
  }
  const seen = new Set<string>();
  return entries
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.order - right.order)
    .filter((entry) => {
      const key = `${entry.timestamp}\n${entry.stream}\n${entry.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-200)
    .map(({ timestamp, stream, text }) => ({ timestamp, stream, text }));
}

function isTerminalMirrorEntry(value: unknown): value is TerminalMirrorEntry {
  const entry = recordValue(value);
  if (!entry) return false;
  return Boolean(entry)
    && typeof entry.timestamp === 'string'
    && (entry.stream === 'stdout' || entry.stream === 'stderr' || entry.stream === 'event')
    && typeof entry.text === 'string';
}

function repairEvidenceCompleteness(audit: FeedbackRepairAuditViewModel, terminal: ReturnType<typeof repairTerminalMirror>) {
  const result = audit.latestResult;
  const run = audit.latestRun;
  const resultMetadata = recordValue(recordValue(result)?.metadata);
  const items = [
    { label: 'plan', ready: Boolean(terminal.planRef), detail: terminal.planRef ?? 'missing plan ref' },
    { label: 'terminal', ready: Boolean(terminal.ref || terminal.entries.length), detail: terminal.ref ?? `${terminal.entries.length} inline lines` },
    { label: 'patch', ready: Boolean(result?.diffRef || result?.refs?.patchRef), detail: result?.diffRef ?? result?.refs?.patchRef ?? 'missing patch ref' },
    { label: 'tests', ready: audit.tests.length > 0, detail: audit.tests.length ? audit.tests.map((test) => `${test.status}:${test.command}`).join(', ') : 'missing test evidence' },
    { label: 'audit', ready: Boolean(terminal.auditBundleRef), detail: terminal.auditBundleRef ?? 'missing audit bundle ref' },
    { label: 'guard-digests', ready: Boolean((run?.baseCommit && run?.dirtyWorktreeDigest && run?.protectedFilesDigest && run?.feedbackDataDigest) || resultMetadata?.guardDigests), detail: run?.baseCommit ?? 'missing base commit or digests' },
  ].map((item) => ({
    label: item.label,
    state: item.ready ? 'ready' : 'missing',
    detail: item.detail,
  }));
  const ready = items.filter((item) => item.state === 'ready').length;
  return {
    status: ready === items.length ? 'complete' : ready > 0 ? 'partial' : 'missing',
    ready,
    total: items.length,
    items,
  };
}

function repairConfirmationBoundaries(audit: FeedbackRepairAuditViewModel) {
  const refs = audit.refs ?? {};
  return [
    {
      label: 'commit',
      value: audit.commit ?? refs.commitSha ?? 'requires user confirmation',
      href: refs.commitUrl,
      state: audit.commit || refs.commitSha ? 'created' : 'blocked',
      icon: 'commit' as const,
    },
    {
      label: 'push / PR',
      value: refs.prUrl ?? 'requires second confirmation',
      href: refs.prUrl,
      state: refs.prUrl ? 'created' : 'blocked',
      icon: 'pr' as const,
    },
    {
      label: 'merge',
      value: 'never automatic',
      state: 'blocked',
      icon: 'merge' as const,
    },
  ];
}

const REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES = [
  'src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx',
  'src/ui/src/feedback',
  'src/ui/src/api/workspaceClient.ts',
  'src/runtime/workspace-server.ts',
  'src/runtime/repair-handoff-runner.ts',
];

export function repairSafeMode(audit: FeedbackRepairAuditViewModel) {
  const resultMetadata = recordValue(audit.latestResult?.metadata);
  const runMetadata = recordValue(audit.latestRun?.metadata);
  const metadataSafeMode = recordValue(resultMetadata?.safeMode) ?? recordValue(runMetadata?.safeMode);
  const metadataMatchedPaths = Array.isArray(metadataSafeMode?.matchedPaths)
    ? metadataSafeMode.matchedPaths.filter((item): item is string => typeof item === 'string')
    : [];
  const matchedPaths = uniqueStrings([
    ...metadataMatchedPaths,
    ...audit.changedFiles.filter((file) => pathMatchesAnySafeModeScope(file)),
  ]);
  const active = metadataSafeMode?.active === true || matchedPaths.length > 0;
  return {
    active,
    message: active
      ? `Repair touches the feedback inbox or repair backend control surface${matchedPaths.length ? `: ${matchedPaths.join(', ')}` : ''}; patch apply, commit, push, and PR actions need extra confirmation or an external control surface.`
      : 'Repair does not currently target the inbox/backend control surface; normal confirmation gates still apply.',
    matchedPaths,
  };
}

function pathMatchesAnySafeModeScope(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  return REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function copyTerminalMirror(text: string, setHint: (hint: string) => void) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setHint('Terminal mirror copied.');
  } catch {
    setHint('Clipboard unavailable; use export instead.');
  }
}

function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'feedback';
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim());
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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
