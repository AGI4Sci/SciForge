import { Plug, Workflow } from 'lucide-react';
import { useI18n } from '../../i18nContext';
import { cx } from '../uiPrimitives';

export function SidebarToolsStrip({
  onOpenComponents,
  onOpenAutomations,
}: {
  onOpenComponents: () => void;
  onOpenAutomations: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sidebar-tools-strip" aria-label={t({ 'zh-CN': '工具', 'en-US': 'Tools' })}>
      <button
        type="button"
        className={cx('nav-item sidebar-command sidebar-tool-item')}
        onClick={onOpenComponents}
        aria-label={t({ 'zh-CN': '应用', 'en-US': 'Apps' })}
      >
        <Plug size={16} />
        <span>{t({ 'zh-CN': '应用', 'en-US': 'Apps' })}</span>
      </button>
      <button
        type="button"
        className={cx('nav-item sidebar-command sidebar-tool-item')}
        onClick={onOpenAutomations}
        aria-label={t({ 'zh-CN': '自动化', 'en-US': 'Automations' })}
      >
        <Workflow size={16} />
        <span>{t({ 'zh-CN': '自动化', 'en-US': 'Automations' })}</span>
      </button>
    </div>
  );
}
