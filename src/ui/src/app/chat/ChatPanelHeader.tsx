import { CircleStop, Clock, Download, Plus, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '../uiPrimitives';
import type { SciForgeConfig } from '../../domain';
import type { ScenarioViewConfig } from '../../data';

export function ChatPanelHeader({
  scenario,
  config,
  archivedCount,
  isSending,
  onConfigChange,
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
      <strong className="panel-scenario-name">{scenario.name}</strong>
      <Badge variant="success" glow>在线</Badge>
      {archivedCount ? <Badge variant="muted">{archivedCount} archived</Badge> : null}
      <label className="backend-picker" title="选择本场景下一次 AgentServer 运行使用的 agent backend">
        <span>backend</span>
        <select value={config.agentBackend} onChange={(event) => onConfigChange({ agentBackend: event.target.value })}>
          <option value="codex">Codex</option>
          <option value="openteam_agent">OpenTeam</option>
          <option value="claude-code">Claude Code</option>
          <option value="hermes-agent">Hermes</option>
          <option value="openclaw">OpenClaw</option>
          <option value="gemini">Gemini</option>
        </select>
      </label>
      <div className="panel-actions">
        <IconButton icon={Plus} label="开启新聊天" onClick={onNewChat} />
        <IconButton icon={Clock} label="历史会话" onClick={onToggleHistory} />
        {isSending ? <IconButton icon={CircleStop} label="中断请求" onClick={onAbort} /> : null}
        <IconButton icon={Download} label="导出当前 Scenario 会话" onClick={onExport} />
        <IconButton icon={Trash2} label="删除当前聊天" onClick={onDeleteChat} />
      </div>
    </div>
  );
}
