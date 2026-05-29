import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { cx } from '../uiPrimitives';

export function WorkspaceExplorerRootTree({
  workspaceRoot,
  rootLabel,
  expanded,
  selected,
  children,
  onRootClick,
  onRootContextMenu,
  onToggleRoot,
}: {
  workspaceRoot: string;
  rootLabel: string;
  expanded: boolean;
  selected: boolean;
  children: ReactNode;
  onRootClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onRootContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onToggleRoot: () => void;
}) {
  return (
    <div className="explorer-section">
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={expanded}
        className={cx('explorer-row', 'explorer-root-row', selected && 'is-selected')}
        style={{ paddingLeft: 8 }}
        onClick={onRootClick}
        onContextMenu={onRootContextMenu}
      >
        <button
          type="button"
          className="explorer-twistie"
          aria-label={expanded ? '折叠' : '展开'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleRoot();
          }}
        >
          {expanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
        </button>
        <FolderOpen size={16} className="explorer-type-icon" aria-hidden />
        <span className="explorer-label">{rootLabel || workspaceRoot}</span>
      </div>
      {expanded ? (
        <div className="explorer-branch explorer-root-children" role="group">
          {children}
        </div>
      ) : null}
    </div>
  );
}
