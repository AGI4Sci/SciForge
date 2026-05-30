import { Settings } from 'lucide-react';
import { useI18n } from '../../i18nContext';

export function SidebarFooterActions({
  onSettingsOpen,
}: {
  onSettingsOpen?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sidebar-footer-actions">
      <button type="button" className="nav-item sidebar-command" onClick={() => onSettingsOpen?.()}>
        <Settings size={17} />
        <span>{t({ 'zh-CN': '设置', 'en-US': 'Settings' })}</span>
      </button>
    </div>
  );
}
