import { useMemo, useState } from 'react';
import { Archive, Clock, Trash2 } from 'lucide-react';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import { ActionButton, Badge } from '../uiPrimitives';
import { buildSidebarArchivedThreadItems } from './ShellPanels';

export function SettingsArchivedChatsPanel({
  archivedSessions,
  scenarioLabelFor,
  onRestore,
  onDelete,
  onClearAll,
}: {
  archivedSessions: SciForgeSession[];
  scenarioLabelFor: (scenarioId: ScenarioInstanceId) => string;
  onRestore: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onDelete: (scenarioId: ScenarioInstanceId, sessionIds: string[]) => void;
  onClearAll: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const items = useMemo(
    () => buildSidebarArchivedThreadItems(archivedSessions, { sort: 'updatedAt' }),
    [archivedSessions],
  );
  const sessionById = useMemo(
    () => new Map(archivedSessions.map((session) => [session.sessionId, session])),
    [archivedSessions],
  );
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  function toggleSelected(sessionId: string) {
    setSelectedIds((current) => current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    const grouped = new Map<ScenarioInstanceId, string[]>();
    for (const sessionId of selectedIds) {
      const session = sessionById.get(sessionId);
      if (!session) continue;
      const bucket = grouped.get(session.scenarioId) ?? [];
      bucket.push(sessionId);
      grouped.set(session.scenarioId, bucket);
    }
    for (const [scenarioId, sessionIds] of grouped) {
      onDelete(scenarioId, sessionIds);
    }
    setSelectedIds([]);
  }

  function clearAll() {
    if (!items.length) return;
    onClearAll();
    setSelectedIds([]);
  }

  if (!items.length) {
    return (
      <div className="settings-archived-empty">
        <Archive size={18} aria-hidden />
        <strong>暂无已归档对话</strong>
        <p>在侧栏项目对话中归档后，历史会话会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="settings-archived-panel">
      <div className="settings-archived-toolbar">
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => setSelectedIds(event.target.checked ? items.map((item) => item.sessionId) : [])}
          />
          <span>全选</span>
        </label>
        <Badge variant={selectedIds.length ? 'info' : 'muted'}>{selectedIds.length} 已选</Badge>
        <button type="button" onClick={deleteSelected} disabled={!selectedIds.length}>删除选中</button>
        <button type="button" onClick={clearAll}>清空全部</button>
      </div>
      <div className="settings-archived-list">
        {items.map((item) => {
          const session = sessionById.get(item.sessionId);
          if (!session) return null;
          return (
            <div key={item.sessionId} className="settings-archived-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.sessionId)}
                onChange={() => toggleSelected(item.sessionId)}
                aria-label={`选择已归档对话 ${item.title}`}
              />
              <div className="settings-archived-copy">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <div className="settings-archived-meta">
                  <code>{scenarioLabelFor(item.scenarioId)}</code>
                  <small>{formatArchivedTime(item.updatedAt)}</small>
                </div>
              </div>
              <ActionButton icon={Clock} variant="secondary" onClick={() => onRestore(item.scenarioId, item.sessionId)}>
                恢复
              </ActionButton>
              <ActionButton
                icon={Trash2}
                variant="secondary"
                onClick={() => onDelete(item.scenarioId, [item.sessionId])}
              >
                删除
              </ActionButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatArchivedTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '未知时间';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}
