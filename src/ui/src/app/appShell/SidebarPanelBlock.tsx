import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../uiPrimitives';

export function SidebarPanelBlock({
  title,
  collapsed,
  className,
  style,
  headerExtra,
  toggleLabel,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  className?: string;
  style?: CSSProperties;
  headerExtra?: ReactNode;
  toggleLabel: { collapsed: string; expanded: string };
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={cx('sidebar-panel-block', className, collapsed && 'is-collapsed')} style={style}>
      <div className="sidebar-panel-block-head">
        <span>{title}</span>
        {headerExtra ? <div className="sidebar-panel-block-head-actions">{headerExtra}</div> : (
          <button
            type="button"
            className="sidebar-panel-toggle"
            onClick={onToggle}
            aria-label={collapsed ? toggleLabel.collapsed : toggleLabel.expanded}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>
      {!collapsed ? children : null}
    </section>
  );
}

export function SidebarPanelToggleButton({
  collapsed,
  toggleLabel,
  onToggle,
}: {
  collapsed: boolean;
  toggleLabel: { collapsed: string; expanded: string };
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="sidebar-panel-toggle"
      onClick={onToggle}
      aria-label={collapsed ? toggleLabel.collapsed : toggleLabel.expanded}
      aria-expanded={!collapsed}
    >
      {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
  );
}
