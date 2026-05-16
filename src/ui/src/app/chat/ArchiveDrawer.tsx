import { useState } from 'react';
import { Clock } from 'lucide-react';
import { validateTaskRunCard, type TaskRunCard, type TaskRunCardRef } from '@sciforge-ui/runtime-contract/task-run-card';
import { ActionButton, Badge } from '../uiPrimitives';
import type { SciForgeRun, SciForgeSession } from '../../domain';
import { runAuditBlockers, runAuditRefs, runRecoverActions } from '../results-renderer-execution-model';
import {
  conversationProjectionAuditRefs,
  conversationProjectionForSession,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionRecoverActions,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';

const archiveAuditRefTerms = [
  ['research', 'report'].join('-'),
  ['paper', 'list'].join('-'),
  'verification',
  ['execution', 'unit'].join('-'),
  'EU-',
  'stdout',
  'stderr',
  'output',
];
const archiveAuditRefPattern = new RegExp(archiveAuditRefTerms.join('|'), 'i');

export function ArchiveDrawer({
  currentSession,
  archivedSessions,
  onRestore,
  onDelete,
  onClear,
}: {
  currentSession: SciForgeSession;
  archivedSessions: SciForgeSession[];
  onRestore: (sessionId: string) => void;
  onDelete: (sessionIds: string[]) => void;
  onClear: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const currentStats = sessionHistoryStats(currentSession);
  const allSelected = archivedSessions.length > 0 && selectedIds.length === archivedSessions.length;
  function toggleSelected(sessionId: string) {
    setSelectedIds((current) => current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]);
  }
  function deleteSelected() {
    if (!selectedIds.length) return;
    onDelete(selectedIds);
    setSelectedIds([]);
  }
  function clearAll() {
    if (!archivedSessions.length) return;
    onClear();
    setSelectedIds([]);
  }
  return (
    <div className="session-history-panel">
      <div className="session-history-head">
        <div>
          <strong>历史会话</strong>
          <span>当前：{currentSession.title}</span>
        </div>
        <Badge variant="muted">{currentStats}</Badge>
      </div>
      {archivedSessions.length ? (
        <div className="session-history-bulkbar">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => setSelectedIds(event.target.checked ? archivedSessions.map((item) => item.sessionId) : [])}
            />
            全选
          </label>
          <Badge variant={selectedIds.length ? 'info' : 'muted'}>{selectedIds.length} selected</Badge>
          <button type="button" onClick={deleteSelected} disabled={!selectedIds.length}>删除选中</button>
          <button type="button" onClick={clearAll}>清空历史</button>
        </div>
      ) : null}
      {!archivedSessions.length ? (
        <div className="empty-runtime-state compact">
          <Badge variant="muted">empty</Badge>
          <strong>暂无归档会话</strong>
          <p>点击开启新聊天或删除当前聊天后，旧会话会进入这里。</p>
        </div>
      ) : (
        <div className="session-history-list">
          {archivedSessions.map((item) => {
            const summary = sessionHistoryRunSummary(item);
            return (
            <div className="session-history-row" key={item.sessionId}>
              <input
                type="checkbox"
                checked={selectedIds.includes(item.sessionId)}
                onChange={() => toggleSelected(item.sessionId)}
                aria-label={`选择历史会话 ${item.title}`}
              />
              <div className="session-history-copy">
                <strong>{item.title}</strong>
                <span>{formatSessionTime(item.updatedAt || item.createdAt)} · {sessionHistoryStats(item)}</span>
                <div className="session-history-meta">
                  {sessionHistoryPackageLabel(item) ? <code>{sessionHistoryPackageLabel(item)}</code> : null}
                  {sessionHistoryLastRunLabel(item) ? <Badge variant={sessionHistoryLastRunVariant(item)}>{sessionHistoryLastRunLabel(item)}</Badge> : <Badge variant="muted">no runs</Badge>}
                  {summary.runId ? <code>{summary.runId}</code> : null}
                </div>
                <p className="session-history-summary">{summary.main}</p>
                {summary.refs.length || summary.recoverActions.length ? (
                  <div className="session-history-meta">
                    {summary.refs.map((ref) => <code key={`${item.sessionId}-${ref}`}>{ref}</code>)}
                    {summary.recoverActions.map((action) => <code key={`${item.sessionId}-${action}`}>{action}</code>)}
                  </div>
                ) : null}
                <small>恢复后当前工作台会切换到该历史会话，右侧结果同步显示对应 run，不会自动重跑历史任务。</small>
              </div>
              <ActionButton icon={Clock} variant="secondary" onClick={() => onRestore(item.sessionId)}>恢复</ActionButton>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function sessionHistoryRunSummary(session: SciForgeSession) {
  const lastRun = session.runs.at(-1);
  const taskRunCard = taskRunCardForRun(lastRun);
  if (taskRunCard) return sessionHistoryTaskRunCardSummary(taskRunCard, lastRun);
  const projection = conversationProjectionForSession(session, lastRun);
  if (projection) return sessionHistoryConversationProjectionSummary(projection, lastRun);
  if (!lastRun) {
    const userMessages = session.messages.filter((message) => message.role === 'user' && !message.id.startsWith('seed')).length;
    return {
      runId: '',
      main: userMessages ? '未执行：仅保留用户消息和草稿上下文。' : '未执行：空草稿会话。',
      refs: [] as string[],
      recoverActions: [] as string[],
    };
  }
  const blockers = runAuditBlockers(session, lastRun).map(compactHistoryText);
  const rawFailure = rawRunFailureReason(lastRun.raw);
  const refs = runAuditRefs(session, lastRun)
    .filter((ref) => archiveAuditRefPattern.test(ref))
    .slice(0, 4);
  const recoverActions = runRecoverActions(session, lastRun).map(compactHistoryText).slice(0, 2);
  const artifactRefs = session.artifacts.slice(0, 3).map((artifact) => artifact.id);
  const statusText = lastRun.status === 'completed'
    ? `完成：${artifactRefs.length ? `产物 ${artifactRefs.join(', ')}` : '没有可见 artifact'}。`
    : lastRun.status === 'failed'
      ? `失败边界：${rawFailure ?? blockers.find((line) => !/^blocker: run\b/i.test(line)) ?? blockers[0] ?? compactHistoryText(lastRun.response || '失败原因未记录')}。`
      : `${lastRun.status}：${compactHistoryText(lastRun.response || lastRun.prompt || '运行状态已记录')}。`;
  return {
    runId: shortRunId(lastRun.id),
    main: statusText,
    refs,
    recoverActions,
  };
}

function sessionHistoryConversationProjectionSummary(projection: UiConversationProjection, lastRun: SciForgeRun | undefined) {
  const reason = conversationProjectionPrimaryDiagnostic(projection)
    ?? conversationProjectionVisibleText(projection)
    ?? projection.backgroundState?.revisionPlan
    ?? 'projection state recorded';
  const refs = conversationProjectionAuditRefs(projection)
    .filter((ref) => archiveAuditRefPattern.test(ref))
    .slice(0, 4);
  return {
    runId: shortRunId(lastRun?.id ?? projection.activeRun?.id ?? projection.conversationId),
    main: `${conversationProjectionStatusLabel(conversationProjectionStatus(projection))}：${compactHistoryText(reason)}。`,
    refs,
    recoverActions: conversationProjectionRecoverActions(projection).map(compactHistoryText).slice(0, 2),
  };
}

function conversationProjectionStatusLabel(status: ReturnType<typeof conversationProjectionStatus>) {
  const labels: Record<ReturnType<typeof conversationProjectionStatus>, string> = {
    idle: '未执行',
    planned: '已计划',
    dispatched: '已分发',
    'partial-ready': '部分结果',
    'output-materialized': '已保存输出',
    validated: '已验证边界',
    satisfied: '完成',
    'degraded-result': '降级结果',
    'external-blocked': '外部阻塞',
    'repair-needed': '需恢复',
    'needs-human': '需人工处理',
    'background-running': '后台继续中',
  };
  return labels[status];
}

function sessionHistoryTaskRunCardSummary(card: TaskRunCard, lastRun: SciForgeRun | undefined) {
  const failureBoundary = card.failureSignatures[0]?.message;
  const completedRefs = card.refs.filter((ref) => ref.kind === 'artifact').slice(0, 3).map(compactTaskRunCardRef);
  const summary = failureBoundary
    ? `失败边界：${compactHistoryText(failureBoundary)}。`
    : card.taskOutcome === 'satisfied'
      ? `${taskRunCardStatusLabel(card.status)}：${completedRefs.length ? `产物 ${completedRefs.join(', ')}` : compactHistoryText(card.goal)}。`
      : `${taskRunCardStatusLabel(card.status)}：${compactHistoryText(card.nextStep || card.rounds.at(-1)?.observed || card.goal)}。`;
  const refs = card.refs
    .filter((ref) => ['artifact', 'execution-unit', 'verification', 'log', 'bundle', 'file'].includes(ref.kind))
    .slice(0, 4)
    .map(compactTaskRunCardRef);
  return {
    runId: shortRunId(card.taskId ?? lastRun?.id ?? card.id),
    main: summary,
    refs,
    recoverActions: card.nextStep ? [compactHistoryText(card.nextStep)] : [],
  };
}

function taskRunCardForRun(run: SciForgeRun | undefined): TaskRunCard | undefined {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const projection = isRecord(displayIntent?.taskOutcomeProjection) ? displayIntent.taskOutcomeProjection : undefined;
  return validTaskRunCard(displayIntent?.taskRunCard) ?? validTaskRunCard(projection?.taskRunCard);
}

function validTaskRunCard(value: unknown): TaskRunCard | undefined {
  return validateTaskRunCard(value).length === 0 ? value as TaskRunCard : undefined;
}

function compactTaskRunCardRef(ref: TaskRunCardRef) {
  const value = compactHistoryText(ref.ref);
  return value.startsWith(`${ref.kind}:`) ? value : `${ref.kind}:${value}`;
}

function taskRunCardStatusLabel(status: TaskRunCard['status']) {
  const labels: Record<TaskRunCard['status'], string> = {
    running: '运行中',
    complete: '完成',
    partial: '部分完成',
    'needs-work': '需继续',
    'needs-human': '需人工处理',
    failed: '失败',
    cancelled: '已取消',
    'not-run': '未执行',
  };
  return labels[status];
}

function rawRunFailureReason(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const failureReason = typeof record.failureReason === 'string' ? record.failureReason : undefined;
  const blocker = typeof record.blocker === 'string' ? record.blocker : undefined;
  const text = failureReason || blocker;
  return text ? compactHistoryText(text) : undefined;
}

function sessionHistoryStats(session: SciForgeSession) {
  const userMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return `${userMessages} messages · ${session.artifacts.length} artifacts · ${session.executionUnits.length} units`;
}

function sessionHistoryPackageLabel(session: SciForgeSession) {
  const lastRun = session.runs.at(-1);
  const ref = lastRun?.scenarioPackageRef;
  if (!ref) return undefined;
  return `${ref.id}@${ref.version}`;
}

function sessionHistoryLastRunLabel(session: SciForgeSession) {
  const lastRun = session.runs.at(-1);
  if (!lastRun) return undefined;
  const projection = conversationProjectionForSession(session, lastRun);
  if (projection) return `projection ${conversationProjectionStatusLabel(conversationProjectionStatus(projection))}`;
  return `last run ${lastRun.status}`;
}

function shortRunId(value: string) {
  return value.replace(/^run-/, '').slice(0, 18);
}

function compactHistoryText(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 150 ? `${text.slice(0, 147).trim()}...` : text;
}

function sessionHistoryLastRunVariant(session: SciForgeSession): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  const lastRun = session.runs.at(-1);
  const projection = conversationProjectionForSession(session, lastRun);
  if (projection) return projectionStatusVariant(conversationProjectionStatus(projection));
  const status = lastRun?.status;
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'idle') return 'muted';
  return 'info';
}

function projectionStatusVariant(status: ReturnType<typeof conversationProjectionStatus>): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'satisfied') return 'success';
  if (status === 'idle') return 'muted';
  if (status === 'external-blocked' || status === 'repair-needed' || status === 'needs-human') return 'warning';
  if (status === 'degraded-result' || status === 'partial-ready' || status === 'background-running') return 'info';
  return 'info';
}

function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
