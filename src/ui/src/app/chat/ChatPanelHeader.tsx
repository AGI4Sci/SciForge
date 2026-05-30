import { CircleStop, Clock, Download, Plus, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '../uiPrimitives';
import type { SciForgeConfig } from '../../domain';
import type { ScenarioViewConfig } from '../../data';
import { useI18n } from '../../i18nContext';

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
  const { t } = useI18n();
  return (
    <div className="panel-title compact">
      <div className="scenario-mini" style={{ background: `${scenario.color}18`, color: scenario.color }}>
        <scenario.icon size={18} />
      </div>
      <strong className="panel-scenario-name">{t({ 'zh-CN': '提问', 'en-US': 'Ask' })}</strong>
      <Badge variant="success" glow>{t({ 'zh-CN': '在线', 'en-US': 'Online' })}</Badge>
      {archivedCount ? (
        <Badge variant="muted">
          {t({ 'zh-CN': `${archivedCount} 个已归档`, 'en-US': `${archivedCount} archived` })}
        </Badge>
      ) : null}
      <div className="panel-actions">
        <IconButton icon={Plus} label={t({ 'zh-CN': '新对话', 'en-US': 'New chat' })} onClick={onNewChat} />
        <IconButton icon={Clock} label={t({ 'zh-CN': '历史', 'en-US': 'History' })} onClick={onToggleHistory} />
        {isSending ? <IconButton icon={CircleStop} label={t({ 'zh-CN': '停止', 'en-US': 'Stop' })} onClick={onAbort} /> : null}
        <IconButton icon={Download} label={t({ 'zh-CN': '导出对话', 'en-US': 'Export chat' })} onClick={onExport} />
        <IconButton icon={Trash2} label={t({ 'zh-CN': '删除对话', 'en-US': 'Delete chat' })} onClick={onDeleteChat} />
      </div>
    </div>
  );
}
