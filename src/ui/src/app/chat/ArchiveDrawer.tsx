import { useState } from 'react';
import { Clock } from 'lucide-react';
import { ActionButton, Badge } from '../uiPrimitives';
import type { SciForgeSession } from '../../domain';

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
          {archivedSessions.map((item) => (
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
                </div>
              </div>
              <ActionButton icon={Clock} variant="secondary" onClick={() => onRestore(item.sessionId)}>恢复</ActionButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  return `last run ${lastRun.status}`;
}

function sessionHistoryLastRunVariant(session: SciForgeSession): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  const status = session.runs.at(-1)?.status;
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'idle') return 'muted';
  return 'info';
}

function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}
