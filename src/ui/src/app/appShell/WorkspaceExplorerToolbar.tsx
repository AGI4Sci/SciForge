import { ChevronsUp, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';

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
  return (
    <div className="scenario-list-explorer-toolbar">
      <div className="explorer-view-toolbar">
        <button
          type="button"
          className="explorer-icon-btn"
          onClick={() => void onCreateFile()}
          title="新建文件"
          aria-label="新建文件"
        >
          <FilePlus size={16} />
        </button>
        <button
          type="button"
          className="explorer-icon-btn"
          onClick={() => void onCreateFolder()}
          title="新建文件夹"
          aria-label="新建文件夹"
        >
          <FolderPlus size={16} />
        </button>
        <button type="button" className="explorer-icon-btn" onClick={() => void onRefresh()} title="刷新" aria-label="刷新">
          <RefreshCw size={16} />
        </button>
        <button type="button" className="explorer-icon-btn" onClick={onCollapseAll} title="全部折叠" aria-label="全部折叠">
          <ChevronsUp size={16} />
        </button>
      </div>
    </div>
  );
}
