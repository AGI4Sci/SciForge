import { Plug, Workflow } from 'lucide-react';
import { Badge, cx } from '../uiPrimitives';

export function SidebarToolsStrip({
  onOpenComponents,
}: {
  onOpenComponents: () => void;
}) {
  return (
    <div className="sidebar-tools-strip" aria-label="工具">
      <button type="button" className={cx('nav-item sidebar-command sidebar-tool-item')} onClick={onOpenComponents}>
        <Plug size={16} />
        <span>应用</span>
      </button>
      <div className="sidebar-static-row sidebar-tool-item muted" aria-label="自动化">
        <Workflow size={16} />
        <span>自动化</span>
        <Badge variant="muted">即将推出</Badge>
      </div>
    </div>
  );
}
