import { CircleStop, Clock, Download, Plus, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '../uiPrimitives';
import type { SciForgeConfig } from '../../domain';
import type { ScenarioViewConfig } from '../../data';

export function ChatPanelHeader({
  scenario,
  config: _config,
  archivedCount,
  isSending,
  onConfigChange: _onConfigChange,
  onNewChat,
  onToggleHistory,
  onAbort,
  onExport,
  onDeleteChat,
}: {
  scenario: ScenarioViewConfig;
  config: SciForgeConfig;
  archivedCount: number;
  isSending: boolean;
  onConfigChange: (patch: Partial<SciForgeConfig>) => void;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onAbort: () => void;
  onExport: () => void;
  onDeleteChat: () => void;
}) {
  return (
    <div className="panel-title compact">
      <div className="scenario-mini" style={{ background: `${scenario.color}18`, color: scenario.color }}>
        <scenario.icon size={18} />
      </div>
      <strong className="panel-scenario-name">Ask SciForge</strong>
      <Badge variant="success" glow>在线</Badge>
      {archivedCount ? <Badge variant="muted">{archivedCount} 已归档</Badge> : null}
      <div className="panel-actions">
        <IconButton icon={Plus} label="开启新聊天" onClick={onNewChat} />
        <IconButton icon={Clock} label="历史会话" onClick={onToggleHistory} />
        {isSending ? <IconButton icon={CircleStop} label="中断请求" onClick={onAbort} /> : null}
        <IconButton icon={Download} label="导出当前聊天" onClick={onExport} />
        <IconButton icon={Trash2} label="删除当前聊天" onClick={onDeleteChat} />
      </div>
    </div>
  );
}
