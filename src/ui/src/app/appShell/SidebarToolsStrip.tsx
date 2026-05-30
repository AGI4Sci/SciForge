import { Plug, Workflow } from 'lucide-react';
import { useI18n } from '../../i18nContext';
import { Badge, cx } from '../uiPrimitives';

export function SidebarToolsStrip({
  onOpenComponents,
}: {
  onOpenComponents: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sidebar-tools-strip" aria-label={t({ 'zh-CN': '工具', 'en-US': 'Tools' })}>
      <button type="button" className={cx('nav-item sidebar-command sidebar-tool-item')} onClick={onOpenComponents}>
        <Plug size={16} />
        <span>{t({ 'zh-CN': '应用', 'en-US': 'Apps' })}</span>
      </button>
      <div className="sidebar-static-row sidebar-tool-item muted" aria-label={t({ 'zh-CN': '自动化', 'en-US': 'Automations' })}>
        <Workflow size={16} />
        <span>{t({ 'zh-CN': '自动化', 'en-US': 'Automations' })}</span>
        <Badge variant="muted">{t({ 'zh-CN': '即将推出', 'en-US': 'Soon' })}</Badge>
      </div>
    </div>
  );
}
