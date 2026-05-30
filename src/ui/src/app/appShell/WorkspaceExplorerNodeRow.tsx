import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { WorkspaceEntry } from '../../api/workspaceClient';
import { useI18n } from '../../i18nContext';
import { cx } from '../uiPrimitives';

export function WorkspaceExplorerNodeRow({
  entry,
  depth,
  expanded,
  selected,
  icon,
  children,
  onEntryClick,
  onEntryContextMenu,
  onToggleFolder,
}: {
  entry: WorkspaceEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  icon: ReactNode;
  children: ReactNode;
  onEntryClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onEntryContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onToggleFolder: () => void;
}) {
  const { t } = useI18n();
  const isFolder = entry.kind === 'folder';
  return (
    <div className="explorer-node">
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={isFolder ? expanded : undefined}
        className={cx('explorer-row', entry.kind === 'file' && 'is-file', selected && 'is-selected')}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={onEntryClick}
        onContextMenu={onEntryContextMenu}
      >
        {isFolder ? (
          <button
            type="button"
            className="explorer-twistie"
            aria-label={expanded
              ? t({ 'zh-CN': '折叠', 'en-US': 'Collapse' })
              : t({ 'zh-CN': '展开', 'en-US': 'Expand' })}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder();
            }}
          >
            {expanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
          </button>
        ) : (
          <span className="explorer-twistie-placeholder" aria-hidden />
        )}
        {isFolder ? <Folder size={16} className="explorer-type-icon" aria-hidden /> : icon}
        <span className="explorer-label">{entry.name}</span>
      </div>
      {isFolder && expanded ? (
        <div className="explorer-branch" role="group">
          {children}
        </div>
      ) : null}
    </div>
  );
}
