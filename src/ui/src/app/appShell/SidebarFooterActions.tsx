import { Settings } from 'lucide-react';

export function SidebarFooterActions({
  onSettingsOpen,
}: {
  onSettingsOpen?: () => void;
}) {
  return (
    <div className="sidebar-footer-actions">
      <button type="button" className="nav-item sidebar-command" onClick={() => onSettingsOpen?.()}>
        <Settings size={17} />
        <span>设置</span>
      </button>
    </div>
  );
}
