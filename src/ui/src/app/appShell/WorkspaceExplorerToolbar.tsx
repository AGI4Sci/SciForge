import { ChevronsUp, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18nContext';

export function WorkspaceExplorerToolbar({
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onCollapseAll,
}: {
  onCreateFile: () => void | Promise<void>;
  onCreateFolder: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onCollapseAll: () => void;
}) {
  const { t } = useI18n();
  const newFileLabel = t({ 'zh-CN': '新建文件', 'en-US': 'New file' });
  const newFolderLabel = t({ 'zh-CN': '新建文件夹', 'en-US': 'New folder' });
  const refreshLabel = t({ 'zh-CN': '刷新', 'en-US': 'Refresh' });
  const collapseAllLabel = t({ 'zh-CN': '全部折叠', 'en-US': 'Collapse all' });
  return (
    <div className="scenario-list-explorer-toolbar">
      <div className="explorer-view-toolbar">
        <button
          type="button"
          className="explorer-icon-btn"
          onClick={() => void onCreateFile()}
          title={newFileLabel}
          aria-label={newFileLabel}
        >
          <FilePlus size={16} />
        </button>
        <button
          type="button"
          className="explorer-icon-btn"
          onClick={() => void onCreateFolder()}
          title={newFolderLabel}
          aria-label={newFolderLabel}
        >
          <FolderPlus size={16} />
        </button>
        <button type="button" className="explorer-icon-btn" onClick={() => void onRefresh()} title={refreshLabel} aria-label={refreshLabel}>
          <RefreshCw size={16} />
        </button>
        <button type="button" className="explorer-icon-btn" onClick={onCollapseAll} title={collapseAllLabel} aria-label={collapseAllLabel}>
          <ChevronsUp size={16} />
        </button>
      </div>
    </div>
  );
}
