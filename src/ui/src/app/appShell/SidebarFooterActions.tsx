import { MessageCircle, Settings, UserCircle } from 'lucide-react';
import { pathBasename } from './explorerModels';
import { useI18n } from '../../i18nContext';
import { cx } from '../uiPrimitives';
import { localeText, type SupportedLocale } from '../../i18n';

export type SidebarFooterHealth = 'connected' | 'syncing' | 'warning' | 'unavailable';

export interface SidebarFooterStatus {
  health: SidebarFooterHealth;
  workspaceLabel: string;
  statusLabel: string;
  contextLabel: string;
}

const DEFAULT_LOCALE: SupportedLocale = 'en-US';

function text(locale: SupportedLocale | undefined, copy: Record<SupportedLocale, string>) {
  return localeText(locale ?? DEFAULT_LOCALE, copy);
}

export function buildSidebarFooterStatus({
  workspacePath,
  workspaceStatus,
  workspaceError,
  locale,
}: {
  workspacePath?: string;
  workspaceStatus?: string;
  workspaceError?: string;
  locale?: SupportedLocale;
}): SidebarFooterStatus {
  const normalizedPath = (workspacePath ?? '').trim();
  const rawLabel = pathBasename(normalizedPath);
  const workspaceLabel = publicWorkspaceLabel(rawLabel, locale);
  const diagnostic = `${workspaceError ?? ''} ${workspaceStatus ?? ''}`;
  const health = sidebarFooterHealth(normalizedPath, diagnostic);
  return {
    health,
    workspaceLabel,
    statusLabel: sidebarFooterStatusLabel(health, locale),
    contextLabel: text(locale, { 'zh-CN': '本地运行时', 'en-US': 'Local runtime' }),
  };
}

function publicWorkspaceLabel(label: string, locale?: SupportedLocale) {
  const fallback = text(locale, { 'zh-CN': '工作区', 'en-US': 'Workspace' });
  const trimmed = label.trim();
  if (!trimmed) return fallback;
  if (/authorization|credential|password|secret|token|api[-_]?key/i.test(trimmed)) return fallback;
  return trimmed.replace(/[^\w .@-]+/g, '').slice(0, 48) || fallback;
}

function sidebarFooterHealth(workspacePath: string, diagnostic: string): SidebarFooterHealth {
  if (!workspacePath) return 'unavailable';
  if (/sync|loading|hydrate|连接中|加载中|同步/i.test(diagnostic)) return 'syncing';
  if (/error|failed|missing|not found|not find|unavailable|denied|不可用|失败|错误|未找到|未连接|未选择/i.test(diagnostic)) return 'warning';
  return 'connected';
}

function sidebarFooterStatusLabel(health: SidebarFooterHealth, locale?: SupportedLocale) {
  if (health === 'syncing') return text(locale, { 'zh-CN': '同步中', 'en-US': 'Syncing' });
  if (health === 'warning') return text(locale, { 'zh-CN': '需注意', 'en-US': 'Needs attention' });
  if (health === 'unavailable') return text(locale, { 'zh-CN': '未连接', 'en-US': 'Unavailable' });
  return text(locale, { 'zh-CN': '已连接', 'en-US': 'Connected' });
}

export function SidebarFooterActions({
  workspacePath,
  workspaceStatus,
  workspaceError,
  feedbackActive = false,
  onFeedbackOpen,
  onSettingsOpen,
}: {
  workspacePath?: string;
  workspaceStatus?: string;
  workspaceError?: string;
  feedbackActive?: boolean;
  onFeedbackOpen?: () => void;
  onSettingsOpen?: () => void;
}) {
  const { locale, t } = useI18n();
  const footerStatus = buildSidebarFooterStatus({ workspacePath, workspaceStatus, workspaceError, locale });
  const feedbackLabel = t({ 'zh-CN': '反馈', 'en-US': 'Feedback' });
  const settingsLabel = t({ 'zh-CN': '设置', 'en-US': 'Settings' });
  return (
    <div
      className="sidebar-footer-actions"
      aria-label={t({ 'zh-CN': '账户、状态和设置', 'en-US': 'Account, status, and settings' })}
    >
      <div
        className={cx('sidebar-footer-status', footerStatus.health)}
        role="status"
        aria-label={`${footerStatus.workspaceLabel}: ${footerStatus.statusLabel}; ${footerStatus.contextLabel}`}
      >
        <UserCircle size={17} aria-hidden />
        <span className="sidebar-footer-status-copy">
          <span>{footerStatus.workspaceLabel}</span>
          <small>{footerStatus.contextLabel}</small>
        </span>
        <span className="sidebar-footer-health" aria-hidden>{footerStatus.statusLabel}</span>
      </div>
      <button type="button" className={cx('nav-item', 'sidebar-command', feedbackActive && 'active')} onClick={() => onFeedbackOpen?.()} aria-current={feedbackActive ? 'page' : undefined}>
        <MessageCircle size={17} aria-hidden />
        <span>{feedbackLabel}</span>
      </button>
      <button type="button" className="nav-item sidebar-command" onClick={() => onSettingsOpen?.()}>
        <Settings size={17} aria-hidden />
        <span>{settingsLabel}</span>
      </button>
    </div>
  );
}
