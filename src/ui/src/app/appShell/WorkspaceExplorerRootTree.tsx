import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { useI18n } from '../../i18nContext';
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
  const { t } = useI18n();
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
          aria-label={expanded
            ? t({ 'zh-CN': '折叠', 'en-US': 'Collapse' })
            : t({ 'zh-CN': '展开', 'en-US': 'Expand' })}
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
