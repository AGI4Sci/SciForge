import { Archive, CircleStop, Clock, Copy, Download, GitFork, MoreHorizontal, PanelBottom, PanelRight, Plus, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '../uiPrimitives';
import type { SciForgeConfig } from '../../domain';
import type { ScenarioViewConfig } from '../../data';
import { useI18n } from '../../i18nContext';
import type { ChatPanelAction, ChatPanelActionId } from './chatPanelActions';

export function ChatPanelHeader({
  scenario,
  config: _config,
  chatTitle,
  requestId,
  archivedCount,
  isSending,
  actions = [],
  onConfigChange: _onConfigChange,
  onNewChat,
  onToggleHistory,
  onAbort,
  onExport,
  onDeleteChat,
  onAction,
}: {
  scenario: ScenarioViewConfig;
  config: SciForgeConfig;
  chatTitle?: string;
  requestId?: string;
  archivedCount: number;
  isSending: boolean;
  actions?: ChatPanelAction[];
  onConfigChange: (patch: Partial<SciForgeConfig>) => void;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onAbort: () => void;
  onExport: () => void;
  onDeleteChat: () => void;
  onAction?: (actionId: ChatPanelActionId) => void;
}) {
  const { t } = useI18n();
  const title = chatTitle?.trim() || t({ 'zh-CN': '新聊天', 'en-US': 'New chat' });
  return (
    <div className="panel-title compact">
      <div className="scenario-mini" style={{ background: `${scenario.color}18`, color: scenario.color }}>
        <scenario.icon size={18} />
      </div>
      <button
        type="button"
        className="chat-title-button"
        onClick={onToggleHistory}
        title={t({ 'zh-CN': '选择或恢复聊天', 'en-US': 'Select or restore chat' })}
      >
        <span>{t({ 'zh-CN': 'Chat title.', 'en-US': 'Chat title.' })}</span>
        <strong className="panel-scenario-name">{title}</strong>
      </button>
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
        <details className="chat-actions-menu">
          <summary aria-label={t({ 'zh-CN': '聊天动作', 'en-US': 'Chat actions' })} title={t({ 'zh-CN': '聊天动作', 'en-US': 'Chat actions' })}>
            <MoreHorizontal size={16} aria-hidden />
          </summary>
          <div className="chat-actions-menu-panel" role="menu">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                data-chat-action={action.id}
                data-effect={action.effect}
                title={action.disabledReason ?? action.auditBoundary}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onAction?.(action.id);
                }}
              >
                <ChatActionIcon actionId={action.id} />
                <span>{action.label}</span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
              </button>
            ))}
            <div className="chat-actions-menu-separator" role="separator" />
            <button type="button" role="menuitem" data-chat-action="export-chat" onClick={onExport}>
              <Download size={14} aria-hidden />
              <span>{t({ 'zh-CN': '导出对话', 'en-US': 'Export chat' })}</span>
            </button>
            <button type="button" role="menuitem" data-chat-action="delete-chat" className="danger" onClick={onDeleteChat}>
              <Trash2 size={14} aria-hidden />
              <span>{t({ 'zh-CN': '删除对话', 'en-US': 'Delete chat' })}</span>
            </button>
            {requestId ? <small>{requestId}</small> : null}
          </div>
        </details>
      </div>
    </div>
  );
}

function ChatActionIcon({ actionId }: { actionId: ChatPanelActionId }) {
  if (actionId === 'split-right') return <PanelRight size={14} aria-hidden />;
  if (actionId === 'split-down') return <PanelBottom size={14} aria-hidden />;
  if (actionId === 'fork-chat') return <GitFork size={14} aria-hidden />;
  if (actionId === 'copy-messages' || actionId === 'copy-request-id') return <Copy size={14} aria-hidden />;
  return <Archive size={14} aria-hidden />;
}
