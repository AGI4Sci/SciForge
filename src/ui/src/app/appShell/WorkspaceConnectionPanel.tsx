import type { RefObject } from 'react';
import { Check } from 'lucide-react';

export function WorkspaceConnectionPanel({
  folderPickerRef,
  pathEditDraft,
  workspaceStatus,
  onPathEditDraftChange,
  onChooseWorkspaceRootPath,
  onRefreshExplorer,
  onWorkspacePathChange,
}: {
  folderPickerRef: RefObject<HTMLDetailsElement | null>;
  pathEditDraft: string;
  workspaceStatus: string;
  onPathEditDraftChange: (value: string) => void;
  onChooseWorkspaceRootPath: () => void | Promise<void>;
  onRefreshExplorer: () => void | Promise<void>;
  onWorkspacePathChange: (value: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="explorer-folder-picker-trigger"
        onClick={() => void onChooseWorkspaceRootPath()}
      >
        打开其他文件夹…
      </button>
      <details ref={folderPickerRef} className="explorer-folder-picker explorer-folder-picker-advanced">
        <summary>手动输入路径</summary>
        <div className="explorer-folder-picker-body">
          <input
            className="workspace-path-editor explorer-path-input"
            value={pathEditDraft}
            onChange={(event) => onPathEditDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onRefreshExplorer();
            }}
            spellCheck={false}
            title={workspaceStatus || '项目根路径'}
            aria-label="项目根路径"
          />
          <div className="explorer-folder-picker-actions">
            <button type="button" className="explorer-cta-btn" onClick={() => onWorkspacePathChange(pathEditDraft.trim())}>
              <Check size={14} />
              用作工作区根目录
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
